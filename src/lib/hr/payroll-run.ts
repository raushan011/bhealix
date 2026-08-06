import { Types } from "mongoose";
import { User } from "@/models/User";
import { PayrollRun, PayrollSettings, Payslip, SalaryStructure } from "@/models/Payroll";
import { monthDays, parseMonth } from "./attendance";
import { attendanceMonth, type ResolvedDay } from "./records";
import {
  computePayslip, DEFAULT_PT_SLABS, monthBounds, onRollDates,
  type ComputedPayslip, type LopBasis, type NamedAmount, type PtSlab, type SalaryComponents,
  type StatutoryProfile
} from "./payroll";

/**
 * Turning a month of attendance into a month of payslips.
 *
 * Everything the run decides is decided here, in one place, so the figures on
 * the screen before approval and the figures written afterwards cannot drift
 * apart. The arithmetic itself lives in `payroll.ts` and is tested on its own;
 * this is the part that knows about the database.
 */

export type PayrollSettingsRecord = {
  lopBasis: LopBasis;
  ptSlabs: PtSlab[];
  ptStateName?: string;
  ptFebruaryAmount?: number | null;
  payDay: number;
  defaultPayMode?: string;
  signatoryName?: string;
  payslipNote?: string;
};

/** The settings document, created with sensible defaults the first time it is asked for. */
export async function loadPayrollSettings(): Promise<PayrollSettingsRecord> {
  const found = await PayrollSettings.findOneAndUpdate(
    { key: "payroll" }, { $setOnInsert: { key: "payroll" } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean() as unknown as PayrollSettingsRecord | null;

  return {
    lopBasis: found?.lopBasis ?? "Calendar days",
    ptSlabs: found?.ptSlabs?.length ? found.ptSlabs : DEFAULT_PT_SLABS,
    ptStateName: found?.ptStateName,
    ptFebruaryAmount: found?.ptFebruaryAmount ?? null,
    payDay: found?.payDay ?? 7,
    defaultPayMode: found?.defaultPayMode,
    signatoryName: found?.signatoryName,
    payslipNote: found?.payslipNote
  };
}

type EmployeeRecord = {
  _id: unknown; name: string; employeeId: string; active: boolean;
  designation?: string; department?: string; workLocation?: string;
  joiningDate?: string; exitDate?: string; employmentStatus?: string;
  panNumber?: string; uan?: string; esicNumber?: string;
  bankAccountNo?: string; bankName?: string;
};

type StructureRecord = SalaryComponents & StatutoryProfile & {
  employee: unknown; effectiveFrom: string;
};

/**
 * Everybody who was on the rolls at any point in the month.
 *
 * Not simply "active employees". Somebody who left on the 9th is owed nine
 * days and is no longer active; somebody who joins next month is active today
 * and is owed nothing for this one. The rolls are a question about dates.
 */
export async function onRollFor(month: string): Promise<EmployeeRecord[]> {
  const { first, last } = monthBounds(month);
  const all = await User.find({})
    .select("name employeeId active designation department workLocation joiningDate exitDate "
      + "employmentStatus panNumber uan esicNumber bankAccountNo bankName")
    .sort({ name: 1 }).lean() as unknown as EmployeeRecord[];

  return all.filter(person => {
    // Joined after the month ended: not yet on the rolls.
    if (person.joiningDate && person.joiningDate > last) return false;
    // Left before it began.
    if (person.exitDate && person.exitDate < first) return false;
    // Deactivated with no leaving date recorded — treated as gone, because the
    // alternative is quietly paying somebody who no longer works here.
    if (!person.active && !person.exitDate) return false;
    return true;
  });
}

/** The revision in force for a month: the latest one that had already started. */
export async function structuresFor(employeeIds: unknown[], month: string) {
  const rows = await SalaryStructure.find({
    employee: { $in: employeeIds.map(id => new Types.ObjectId(String(id))) },
    effectiveFrom: { $lte: month }
  }).sort({ effectiveFrom: 1 }).lean() as unknown as StructureRecord[];

  // Sorted ascending, so the last one written for a person wins.
  const inForce = new Map<string, StructureRecord>();
  for (const row of rows) inForce.set(String(row.employee), row);
  return inForce;
}

/**
 * The days of the month a salary is divided by, and the days this person is
 * being paid for.
 *
 * On the working-days basis a week off and a company holiday are not days of
 * work, so they come out of both the divisor and the count — which is what
 * makes a holiday-heavy month pay more per day rather than less in total.
 */
export function daysFor(days: ResolvedDay[], basis: LopBasis, joiningDate?: string, exitDate?: string) {
  const counts = (day: ResolvedDay) =>
    basis === "Calendar days" || (day.status !== "Week off" && day.status !== "Holiday");

  const onRoll = new Set(onRollDates(days.map(day => day.date), joiningDate, exitDate));

  return {
    divisorDays: days.filter(counts).length,
    onRollDays: days.filter(day => counts(day) && onRoll.has(day.date)).length,
    lopDays: lossOfPay(days.filter(day => onRoll.has(day.date)))
  };
}

/**
 * Days of salary lost.
 *
 * A day is only lost when somebody has said so. An absence is a day lost, and
 * so is unpaid leave; approved paid leave is not, and neither is a half day of
 * it, because the other half was worked.
 *
 * A day with no mark at all is deliberately not a loss. The attendance sheet
 * treats "nobody has said yet" as honestly different from "absent", and payroll
 * has no business being the screen that quietly turns the first into the
 * second — an unmarked day docking somebody's salary is how an HR desk loses
 * the trust of the field.
 */
export function lossOfPay(days: ResolvedDay[]): number {
  let lost = 0;
  for (const day of days) {
    if (day.status === "Absent") lost += 1;
    else if (day.status === "On leave") lost += day.leaveType === "Unpaid" ? 1 : 0;
    else if (day.status === "Half day") {
      // Half a day of paid leave costs nothing; anything else costs half.
      lost += day.source === "Leave" && day.leaveType !== "Unpaid" ? 0 : 0.5;
    }
  }
  return lost;
}

export type BuiltPayslip = ComputedPayslip & {
  employee: unknown;
  snapshot: Record<string, unknown>;
  daysInMonth: number;
  onRollDays: number;
};

export type BuildResult = {
  month: string;
  lopBasis: LopBasis;
  payslips: BuiltPayslip[];
  skipped: Array<{ employee: unknown; name: string; employeeId: string; reason: string }>;
  totals: { employees: number; gross: number; deductions: number; netPay: number; employerCost: number };
};

/**
 * Works the whole month out without writing anything.
 *
 * Separated from saving so the same code answers "what would this month cost"
 * on a preview and "what does it cost" on a generate — a payroll somebody can
 * only see by committing to it is one they will commit to without looking.
 */
export async function buildPayroll(month: string): Promise<BuildResult> {
  const parsed = parseMonth(month);
  if (!parsed) throw new Error("Give the month as yyyy-mm");

  const settings = await loadPayrollSettings();
  const employees = await onRollFor(month);
  const days = monthDays(parsed.year, parsed.month);

  const payslips: BuiltPayslip[] = [];
  const skipped: BuildResult["skipped"] = [];

  if (!employees.length) {
    return { month, lopBasis: settings.lopBasis, payslips, skipped, totals: emptyTotals() };
  }

  const ids = employees.map(person => person._id);
  const [structures, attendance] = await Promise.all([
    structuresFor(ids, month),
    attendanceMonth(ids, parsed.year, parsed.month)
  ]);

  for (const person of employees) {
    const structure = structures.get(String(person._id));
    if (!structure) {
      skipped.push({
        employee: person._id, name: person.name, employeeId: person.employeeId,
        reason: "No salary has been set for this employee"
      });
      continue;
    }

    const resolved = attendance.get(String(person._id)) ?? [];
    const counted = daysFor(resolved, settings.lopBasis, person.joiningDate, person.exitDate);

    if (counted.onRollDays <= 0) {
      skipped.push({
        employee: person._id, name: person.name, employeeId: person.employeeId,
        reason: "Not on the rolls for any day of this month"
      });
      continue;
    }

    const computed = computePayslip({
      components: componentsOf(structure),
      statutory: statutoryOf(structure),
      attendance: counted,
      month: parsed.month,
      ptSlabs: settings.ptSlabs,
      ptFebruaryAmount: settings.ptFebruaryAmount
    });

    payslips.push({
      ...computed,
      employee: person._id,
      daysInMonth: days.length,
      onRollDays: counted.onRollDays,
      snapshot: {
        name: person.name,
        employeeId: person.employeeId,
        designation: person.designation,
        department: person.department,
        workLocation: person.workLocation,
        joiningDate: person.joiningDate,
        exitDate: person.exitDate,
        employmentStatus: person.employmentStatus,
        panNumber: person.panNumber,
        uan: person.uan,
        esicNumber: person.esicNumber,
        // A payslip is handed around; the whole account number has no business on it.
        bankAccountLastFour: person.bankAccountNo?.trim().slice(-4),
        bankName: person.bankName
      }
    });
  }

  return {
    month,
    lopBasis: settings.lopBasis,
    payslips,
    skipped,
    totals: {
      employees: payslips.length,
      gross: sum(payslips.map(slip => slip.gross)),
      deductions: sum(payslips.map(slip => slip.totalDeductions)),
      netPay: sum(payslips.map(slip => slip.netPay)),
      employerCost: sum(payslips.map(slip => slip.costToCompany))
    }
  };
}

/**
 * Writes a month's payroll as a draft run, replacing whatever draft was there.
 *
 * Regenerating is the ordinary way to work: attendance gets corrected, a joiner
 * is added, a salary is fixed, and the month is built again. Only a draft can
 * be replaced — an approved run is refused by the route that calls this, so
 * committed figures are never quietly rewritten underneath somebody.
 */
export async function saveDraftRun(month: string, actor: string) {
  const built = await buildPayroll(month);
  const now = new Date();

  const run = await PayrollRun.findOneAndUpdate(
    { month },
    {
      $set: {
        month,
        status: "Draft",
        lopBasis: built.lopBasis,
        totals: built.totals,
        skipped: built.skipped,
        generatedBy: actor,
        generatedAt: now
      },
      // A regenerated draft carries no approval or payment from a previous life.
      // Written out as operators rather than left to be inferred, because a
      // half-cleared run would show an approver beside figures they never saw.
      $unset: { approvedBy: "", approvedAt: "", paidBy: "", paidAt: "", paymentDate: "", paymentMode: "", reference: "" }
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  // Rebuilt from scratch rather than patched: a person who has left the rolls
  // since the last attempt must lose their payslip, not keep a stale one.
  await Payslip.deleteMany({ month });
  if (built.payslips.length) {
    await Payslip.insertMany(built.payslips.map(slip => ({
      run: run._id,
      month,
      employee: slip.employee,
      status: "Draft",
      snapshot: slip.snapshot,
      daysInMonth: slip.daysInMonth,
      divisorDays: slip.divisorDays,
      onRollDays: slip.onRollDays,
      lopDays: slip.lopDays,
      paidDays: slip.paidDays,
      earnings: slip.earnings,
      gross: slip.gross,
      deductions: slip.deductions,
      totalDeductions: slip.totalDeductions,
      employerContributions: slip.employerContributions,
      costToCompany: slip.costToCompany,
      netPayable: slip.netPayable,
      netPay: slip.netPay,
      roundOff: slip.roundOff,
      pfWages: slip.pfWages,
      esiWages: slip.esiWages,
      fullGross: slip.fullGross
    })));
  }

  return run;
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const emptyTotals = () => ({ employees: 0, gross: 0, deductions: 0, netPay: 0, employerCost: 0 });

export const componentsOf = (structure: SalaryComponents): SalaryComponents => ({
  basic: structure.basic ?? 0,
  hra: structure.hra ?? 0,
  conveyance: structure.conveyance ?? 0,
  medical: structure.medical ?? 0,
  special: structure.special ?? 0,
  otherAllowances: (structure.otherAllowances ?? []) as NamedAmount[]
});

export const statutoryOf = (structure: StatutoryProfile): StatutoryProfile => ({
  pfApplicable: structure.pfApplicable ?? true,
  pfOnFullBasic: structure.pfOnFullBasic ?? false,
  esiApplicable: structure.esiApplicable ?? true,
  professionalTaxApplicable: structure.professionalTaxApplicable ?? true,
  monthlyTds: structure.monthlyTds ?? 0,
  recurringDeductions: (structure.recurringDeductions ?? []) as NamedAmount[]
});
