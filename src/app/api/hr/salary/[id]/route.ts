import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { User } from "@/models/User";
import { Payslip, SalaryStructure } from "@/models/Payroll";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { record } from "@/lib/audit";
import { fullGrossOf } from "@/lib/hr/payroll";
import { componentsOf, loadPayrollSettings } from "@/lib/hr/payroll-run";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const amount = z.number().min(0).max(10_000_000);
const namedAmounts = z.array(z.object({
  name: z.string().trim().min(1).max(60),
  amount
})).max(12).default([]);

const schema = z.object({
  effectiveFrom: z.string().regex(MONTH, "Give the month as yyyy-mm"),
  basic: amount,
  hra: amount.default(0),
  conveyance: amount.default(0),
  medical: amount.default(0),
  special: amount.default(0),
  otherAllowances: namedAmounts,

  pfApplicable: z.boolean().default(true),
  pfOnFullBasic: z.boolean().default(false),
  esiApplicable: z.boolean().default(true),
  professionalTaxApplicable: z.boolean().default(true),
  monthlyTds: amount.default(0),
  recurringDeductions: namedAmounts,
  note: z.string().trim().max(300).optional()
});

/**
 * Somebody's whole salary history, newest first.
 *
 * Everybody may read their own; only the HR desk may read anybody else's. A
 * salary is the one figure in an employment record that colleagues must not be
 * able to look up about each other.
 */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Invalid employee reference");

    const own = id === auth.session.userId;
    if (!own && !can.viewPayroll(auth.session.role)) {
      return badRequest("You do not have access to this record", 403);
    }

    await connectDb();
    const [revisions, settings] = await Promise.all([
      SalaryStructure.find({ employee: id })
        .populate("createdBy", "name")
        .sort({ effectiveFrom: -1 }).lean() as unknown as Promise<Array<Record<string, unknown>>>,
      loadPayrollSettings()
    ]);

    return ok({
      items: revisions.map(revision => ({
        ...revision,
        // Worked out here rather than on the screen, so the monthly and annual
        // figures on a revision cannot disagree with the payslip it produces.
        monthlyGross: fullGrossOf(componentsOf(revision as never)),
        annualGross: fullGrossOf(componentsOf(revision as never)) * 12
      })),
      mayEdit: can.runPayroll(auth.session.role),
      // So the screen says what will actually be deducted rather than what the
      // record would ask for if the company were running a fund.
      pfEnabled: settings.pfEnabled
    });
  } catch (error) {
    return fail(error);
  }
}

/**
 * Records a salary, from a month forward.
 *
 * Never an edit of what is already there: a raise in July must leave June's
 * payslip saying what June paid. Sending the same `effectiveFrom` twice corrects
 * that revision, which is the one case where overwriting is right — somebody
 * mistyped a figure they have not yet paid on.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.runPayroll);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Invalid employee reference");

    const value = schema.parse(await request.json());

    await connectDb();
    const employee = await User.findById(id).select("name employeeId joiningDate").lean() as
      { name: string; employeeId: string; joiningDate?: string } | null;
    if (!employee) return badRequest("Employee not found", 404);

    // A salary cannot start before the person did.
    if (employee.joiningDate && value.effectiveFrom < employee.joiningDate.slice(0, 7)) {
      return badRequest(`${employee.name} joined in ${employee.joiningDate.slice(0, 7)} — a salary cannot start before that`);
    }

    // A month already paid must not have its salary rewritten underneath it.
    const settled = await Payslip.findOne({
      employee: id, month: { $gte: value.effectiveFrom }, status: { $in: ["Approved", "Paid"] }
    }).select("month").lean() as { month: string } | null;
    if (settled) {
      return badRequest(
        `A payslip for ${settled.month} has already been approved. Set this revision from the month after it, `
        + "or reopen that payroll run first."
      );
    }

    const saved = await SalaryStructure.findOneAndUpdate(
      { employee: id, effectiveFrom: value.effectiveFrom },
      { ...value, employee: id, createdBy: auth.session.userId },
      { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
    );

    await record({
      actor: auth.session.userId, action: "salary.revised", entityType: "User", entityId: id,
      metadata: {
        name: employee.name, effectiveFrom: value.effectiveFrom,
        monthlyGross: fullGrossOf(componentsOf(value)), note: value.note
      }
    });

    return ok(saved, 201);
  } catch (error) {
    return fail(error);
  }
}

/**
 * Removes a revision entered by mistake.
 *
 * Only one that has never been paid on. A revision a payslip was built from is
 * part of the record of what somebody was paid, and deleting it would leave that
 * payslip unable to explain itself.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.runPayroll);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Invalid employee reference");

    const effectiveFrom = new URL(request.url).searchParams.get("effectiveFrom") ?? "";
    if (!MONTH.test(effectiveFrom)) return badRequest("Give the revision month as yyyy-mm");

    await connectDb();
    const paid = await Payslip.countDocuments({ employee: id, month: { $gte: effectiveFrom } });
    if (paid) {
      return badRequest("A payslip has already been worked out from this revision — it cannot be removed");
    }

    const removed = await SalaryStructure.findOneAndDelete({ employee: id, effectiveFrom });
    if (!removed) return badRequest("That revision no longer exists", 404);

    await record({
      actor: auth.session.userId, action: "salary.revision.deleted",
      entityType: "User", entityId: id, metadata: { effectiveFrom }
    });

    return ok({ deleted: true });
  } catch (error) {
    return fail(error);
  }
}
