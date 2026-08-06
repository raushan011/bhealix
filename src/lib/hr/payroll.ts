/**
 * Payroll vocabulary and arithmetic.
 *
 * Free of Mongoose and of React, like the rest of `lib/hr`, so the salary form
 * on the screen, the monthly run on the server and the payslip that prints all
 * work a figure out the same way. A payslip that disagrees with the screen that
 * produced it is the one bug in payroll nobody forgives.
 *
 * Everything here is in whole rupees. Salaries in India are paid, reported and
 * challaned in rupees, and carrying paise through a dozen components only
 * produces a payslip whose parts do not add up to its total.
 */

// ------------------------------------------------------------------ vocabulary

/**
 * A run moves one way: drafted, approved, paid. Approval is the point of no
 * return — after it the figures are what the company has committed to, so a
 * payslip is never recomputed, only reopened as a whole run and only before it
 * has been paid.
 */
export const PAYROLL_STATUSES = ["Draft", "Approved", "Paid"] as const;
export type PayrollStatus = (typeof PAYROLL_STATUSES)[number];

export const PAY_MODES = ["Bank transfer", "Cash", "UPI", "Cheque"] as const;
export type PayMode = (typeof PAY_MODES)[number];

/** Where somebody stands in their employment, which decides how they are paid. */
export const EMPLOYMENT_STATUSES = ["Probation", "Confirmed", "Notice period", "Exited"] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];

/**
 * What one day of salary is worth.
 *
 * Calendar days is the ordinary Indian practice — a month's salary divided by
 * the days in that month, so February pays the same as March. Working days
 * divides by the days somebody was actually expected to work, which pays more
 * per day in a month full of holidays. Both are legitimate; a company picks one
 * and must not change it halfway through a year.
 */
export const LOP_BASES = ["Calendar days", "Working days"] as const;
export type LopBasis = (typeof LOP_BASES)[number];

// ------------------------------------------------------------------- statutory

/** Provident fund is calculated on wages up to this, unless the company pays on the whole basic. */
export const PF_WAGE_CEILING = 15_000;
export const PF_EMPLOYEE_RATE = 0.12;
export const PF_EMPLOYER_RATE = 0.12;
/** The employer's 12% splits: 8.33% to the pension scheme, the rest to the fund. */
export const EPS_RATE = 0.0833;
export const EPS_WAGE_CEILING = 15_000;

/** Employees' State Insurance covers wages up to this figure. */
export const ESI_WAGE_CEILING = 21_000;
export const ESI_EMPLOYEE_RATE = 0.0075;
export const ESI_EMPLOYER_RATE = 0.0325;

/** The accepted monthly provision for gratuity — 15 days' basic a year, spread over twelve. */
export const GRATUITY_RATE = 0.0481;

/**
 * Professional tax as a slab table rather than nine states written into the
 * code.
 *
 * It is a state tax: the slabs differ in every state and are changed by state
 * budgets on their own timetable. Holding them as data means a company in a
 * state we have never heard of is served, and a slab change is a Saturday
 * afternoon at the HR desk rather than a release.
 */
export type PtSlab = { upTo: number | null; amount: number };

/** Karnataka's slabs, as a starting point somebody will recognise and edit. */
export const DEFAULT_PT_SLABS: PtSlab[] = [
  { upTo: 24_999, amount: 0 },
  { upTo: null, amount: 200 }
];

export const rupees = (value: number) => Number.isFinite(value) ? Math.round(value) : 0;

/**
 * Professional tax for one month.
 *
 * `februaryAmount` exists for Maharashtra and the states that copy it, where
 * the annual ceiling of ₹2,500 is met by charging ₹300 in the last month of the
 * financial year instead of ₹200. Left empty, every month is charged alike.
 */
export function professionalTax(
  monthlyGross: number,
  slabs: PtSlab[] = DEFAULT_PT_SLABS,
  month?: number,
  februaryAmount?: number | null
): number {
  if (monthlyGross <= 0 || !slabs.length) return 0;
  if (month === 2 && februaryAmount) {
    // The February figure only applies to somebody who is liable at all.
    const ordinary = slabFor(monthlyGross, slabs);
    return ordinary > 0 ? rupees(februaryAmount) : 0;
  }
  return slabFor(monthlyGross, slabs);
}

function slabFor(gross: number, slabs: PtSlab[]): number {
  // Open-ended slabs last, so an unsorted table from the settings screen still
  // reads correctly.
  const ordered = [...slabs].sort((a, b) =>
    a.upTo === null ? 1 : b.upTo === null ? -1 : a.upTo - b.upTo);
  for (const slab of ordered) {
    if (slab.upTo === null || gross <= slab.upTo) return rupees(slab.amount);
  }
  return 0;
}

// --------------------------------------------------------------- salary shapes

export type NamedAmount = { name: string; amount: number };

/** What somebody earns in a full month, before attendance is taken into account. */
export type SalaryComponents = {
  basic: number;
  hra: number;
  conveyance: number;
  medical: number;
  special: number;
  /** Anything the company pays this person that the fixed heads do not cover. */
  otherAllowances: NamedAmount[];
};

export const EMPTY_COMPONENTS: SalaryComponents = {
  basic: 0, hra: 0, conveyance: 0, medical: 0, special: 0, otherAllowances: []
};

/** The named heads, in the order a payslip lists them. */
export const EARNING_HEADS = [
  { key: "basic", label: "Basic" },
  { key: "hra", label: "House rent allowance" },
  { key: "conveyance", label: "Conveyance allowance" },
  { key: "medical", label: "Medical allowance" },
  { key: "special", label: "Special allowance" }
] as const;

export type StatutoryProfile = {
  /** Provident fund, on for most and off for a contractor or a consultant. */
  pfApplicable: boolean;
  /**
   * Whether the fund is calculated on the whole basic or only on the first
   * ₹15,000. The ceiling is the statutory minimum; paying above it is a
   * company's own choice and cannot be changed for one month at a time.
   */
  pfOnFullBasic: boolean;
  /** Set from the wage ceiling by default; an override covers somebody exempt. */
  esiApplicable: boolean;
  professionalTaxApplicable: boolean;
  /** What the employee's own declaration works out to each month. */
  monthlyTds: number;
  /** Loan instalments, advances being recovered, anything else agreed. */
  recurringDeductions: NamedAmount[];
};

export const DEFAULT_STATUTORY: StatutoryProfile = {
  pfApplicable: true,
  pfOnFullBasic: false,
  esiApplicable: true,
  professionalTaxApplicable: true,
  monthlyTds: 0,
  recurringDeductions: []
};

/** How much of the month this person is being paid for. */
export type AttendanceBasis = {
  /** Days in the month by the chosen basis — the divisor for a day's pay. */
  divisorDays: number;
  /** Days of that month they were on the rolls: a joiner or a leaver has fewer. */
  onRollDays: number;
  /** Days lost to unpaid leave, absence or an uncovered half day. */
  lopDays: number;
};

export type PayslipInput = {
  components: SalaryComponents;
  statutory: StatutoryProfile;
  attendance: AttendanceBasis;
  /** 1–12. Only read for the February professional tax rule. */
  month: number;
  ptSlabs?: PtSlab[];
  ptFebruaryAmount?: number | null;
};

export type ComputedPayslip = {
  /** What a full month would have paid, for the payslip to show beside the actual. */
  fullGross: number;
  paidDays: number;
  lopDays: number;
  divisorDays: number;

  earnings: NamedAmount[];
  gross: number;

  deductions: NamedAmount[];
  totalDeductions: number;

  /** Costs the company carries that never appear in the employee's hand. */
  employerContributions: NamedAmount[];
  costToCompany: number;

  netPayable: number;
  netPay: number;
  roundOff: number;

  /** Set out separately because they are reported and challaned on their own. */
  pfWages: number;
  esiWages: number;
};

// ------------------------------------------------------------------ the payslip

export const fullGrossOf = (components: SalaryComponents) =>
  rupees(components.basic + components.hra + components.conveyance + components.medical + components.special
    + components.otherAllowances.reduce((sum, item) => sum + (Number(item.amount) || 0), 0));

/**
 * One month's pay for one person.
 *
 * The order matters and is the whole of the rule:
 *
 *   1. Each earning head is pro-rated for attendance and rounded on its own,
 *      and the gross is their sum. Pro-rating the gross instead would give a
 *      payslip whose lines do not add up to its total — the first thing an
 *      employee notices and the last thing they forgive.
 *   2. Provident fund follows the basic actually paid, not the basic on paper,
 *      because a month of unpaid leave reduces the wages the fund is due on.
 *   3. Employees' State Insurance is decided by what the person earns in a full
 *      month: eligibility is a property of the wage, not of how much leave they
 *      happened to take. It is then charged on what is actually paid.
 *   4. The employer's own contributions are set out but never deducted. They are
 *      a cost to the company and are shown so the cost to company is honest.
 */
export function computePayslip(input: PayslipInput): ComputedPayslip {
  const { components, statutory, attendance, month } = input;
  const divisorDays = Math.max(0, attendance.divisorDays);
  const lopDays = Math.max(0, attendance.lopDays);
  const onRollDays = Math.max(0, Math.min(attendance.onRollDays, divisorDays));
  const paidDays = Math.max(0, onRollDays - lopDays);
  const factor = divisorDays > 0 ? paidDays / divisorDays : 0;

  const fullGross = fullGrossOf(components);
  const prorate = (amount: number) => rupees((Number(amount) || 0) * factor);

  const earnings: NamedAmount[] = [
    ...EARNING_HEADS.map(head => ({ name: head.label, amount: prorate(components[head.key]) })),
    ...components.otherAllowances.map(item => ({ name: item.name, amount: prorate(item.amount) }))
  ].filter(item => item.amount !== 0 || item.name === "Basic");

  const gross = earnings.reduce((sum, item) => sum + item.amount, 0);

  // Provident fund, on the basic actually paid.
  const paidBasic = prorate(components.basic);
  const pfWages = statutory.pfApplicable
    ? (statutory.pfOnFullBasic ? paidBasic : Math.min(paidBasic, PF_WAGE_CEILING))
    : 0;
  const employeePf = rupees(pfWages * PF_EMPLOYEE_RATE);
  const employerPfTotal = rupees(pfWages * PF_EMPLOYER_RATE);
  const pensionShare = rupees(Math.min(pfWages, EPS_WAGE_CEILING) * EPS_RATE);
  const fundShare = Math.max(0, employerPfTotal - pensionShare);

  // State insurance: eligibility on the full wage, charged on what is paid.
  // Both sides are rounded up to the next rupee, as the scheme requires.
  const esiCovered = statutory.esiApplicable && fullGross > 0 && fullGross <= ESI_WAGE_CEILING;
  const esiWages = esiCovered ? gross : 0;
  const employeeEsi = esiCovered ? Math.ceil(esiWages * ESI_EMPLOYEE_RATE) : 0;
  const employerEsi = esiCovered ? Math.ceil(esiWages * ESI_EMPLOYER_RATE) : 0;

  const pt = statutory.professionalTaxApplicable
    ? professionalTax(gross, input.ptSlabs, month, input.ptFebruaryAmount)
    : 0;
  const tds = rupees(Math.max(0, statutory.monthlyTds));

  // A recurring recovery is an agreed instalment, not a share of the month, so
  // it is never pro-rated: half a month's work does not halve a loan repayment.
  const recurring = statutory.recurringDeductions
    .map(item => ({ name: item.name, amount: rupees(Math.max(0, Number(item.amount) || 0)) }))
    .filter(item => item.amount > 0);

  const deductions: NamedAmount[] = [
    { name: "Provident fund", amount: employeePf },
    { name: "State insurance (ESI)", amount: employeeEsi },
    { name: "Professional tax", amount: pt },
    { name: "Income tax (TDS)", amount: tds },
    ...recurring
  ].filter(item => item.amount > 0);

  const totalDeductions = deductions.reduce((sum, item) => sum + item.amount, 0);

  const employerContributions: NamedAmount[] = [
    { name: "Provident fund — pension share", amount: pensionShare },
    { name: "Provident fund — fund share", amount: fundShare },
    { name: "State insurance (ESI)", amount: employerEsi },
    { name: "Gratuity provision", amount: rupees(paidBasic * GRATUITY_RATE) }
  ].filter(item => item.amount > 0);

  const netPayable = gross - totalDeductions;
  const netPay = rupees(netPayable);

  return {
    fullGross,
    paidDays: Number(paidDays.toFixed(2)),
    lopDays: Number(lopDays.toFixed(2)),
    divisorDays,
    earnings,
    gross,
    deductions,
    totalDeductions,
    employerContributions,
    costToCompany: gross + employerContributions.reduce((sum, item) => sum + item.amount, 0),
    netPayable,
    netPay,
    // Shown on the payslip rather than absorbed, so gross less deductions can
    // always be checked against the figure in the bank.
    roundOff: Number((netPay - netPayable).toFixed(2)),
    pfWages,
    esiWages
  };
}

// ------------------------------------------------------------------- the month

/** "2026-08" → "August 2026", for a payslip heading. */
export function monthLabel(month: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return month;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  return date.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

/** The month before this one, as "yyyy-mm" — payroll is nearly always run in arrears. */
export function previousMonth(from: Date = new Date()): string {
  const date = new Date(from.getFullYear(), from.getMonth() - 1, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** The first and last calendar day of a "yyyy-mm", as "yyyy-mm-dd". */
export function monthBounds(month: string): { first: string; last: string } {
  const [year, index] = month.split("-").map(Number);
  const total = new Date(year, index, 0).getDate();
  return { first: `${month}-01`, last: `${month}-${String(total).padStart(2, "0")}` };
}

/**
 * The days of a month somebody was on the rolls.
 *
 * Somebody who joined on the 18th is owed thirteen days of August, not a month;
 * somebody who left on the 9th is owed nine. Both are ordinary and both are got
 * wrong by paying a full month and correcting it afterwards.
 */
export function onRollDates(days: string[], joiningDate?: string | null, exitDate?: string | null): string[] {
  return days.filter(date =>
    (!joiningDate || date >= joiningDate) && (!exitDate || date <= exitDate));
}

export const payrollTone = (status: PayrollStatus) =>
  status === "Paid" ? "success" as const : status === "Approved" ? "info" as const : "warn" as const;

/** A run may only be changed while it is a draft; approval is what freezes it. */
export const canEditRun = (status: PayrollStatus) => status === "Draft";
/** Money already paid cannot be unapproved — the correction is a fresh entry, not a rewrite. */
export const canReopenRun = (status: PayrollStatus) => status === "Approved";
