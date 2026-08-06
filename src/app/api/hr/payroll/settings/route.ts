import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { PayrollRun, PayrollSettings } from "@/models/Payroll";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok } from "@/lib/api";
import { record } from "@/lib/audit";
import { LOP_BASES, PAY_MODES } from "@/lib/hr/payroll";
import { loadPayrollSettings } from "@/lib/hr/payroll-run";

const schema = z.object({
  lopBasis: z.enum(LOP_BASES),
  ptStateName: z.string().trim().max(60).optional(),
  ptSlabs: z.array(z.object({
    /** Null is the open-ended top slab — everything above the one before it. */
    upTo: z.number().min(0).max(10_000_000).nullable(),
    amount: z.number().min(0).max(10_000)
  })).max(12).default([]),
  ptFebruaryAmount: z.number().min(0).max(10_000).nullable().optional(),
  payDay: z.number().int().min(1).max(31),
  defaultPayMode: z.enum(PAY_MODES).optional(),
  signatoryName: z.string().trim().max(80).optional(),
  payslipNote: z.string().trim().max(300).optional()
});

export async function GET() {
  try {
    const auth = await apiSession(can.viewPayroll);
    if ("response" in auth) return auth.response;
    await connectDb();
    return ok({ settings: await loadPayrollSettings(), mayEdit: can.runPayroll(auth.session.role) });
  } catch (error) {
    return fail(error);
  }
}

/**
 * Changes how payroll is worked out.
 *
 * The day basis is refused while a draft month is open. Changing it under a run
 * that has already been built would leave the figures on the screen and the
 * figures in the payslips describing different rules, and nobody would be able
 * to tell which. Every run also keeps its own copy of the basis, so past months
 * stay readable whatever is set here later.
 */
export async function PUT(request: Request) {
  try {
    const auth = await apiSession(can.runPayroll);
    if ("response" in auth) return auth.response;

    const value = schema.parse(await request.json());
    await connectDb();

    const current = await loadPayrollSettings();
    if (value.lopBasis !== current.lopBasis) {
      const open = await PayrollRun.findOne({ status: "Draft" }).select("month").lean() as { month: string } | null;
      if (open) {
        return badRequest(`${open.month} is still a draft. Approve or delete it before changing how a day is counted.`);
      }
    }

    const saved = await PayrollSettings.findOneAndUpdate(
      { key: "payroll" },
      { ...value, key: "payroll", ptFebruaryAmount: value.ptFebruaryAmount ?? null },
      { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
    ).lean();

    await record({
      actor: auth.session.userId, action: "payroll.settings.updated", entityType: "PayrollSettings",
      entityId: null, metadata: { lopBasis: value.lopBasis, ptState: value.ptStateName, payDay: value.payDay }
    });

    return ok(saved);
  } catch (error) {
    return fail(error);
  }
}
