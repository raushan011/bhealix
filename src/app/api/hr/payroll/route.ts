import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { PayrollRun } from "@/models/Payroll";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok } from "@/lib/api";
import { record } from "@/lib/audit";
import { buildPayroll, saveDraftRun } from "@/lib/hr/payroll-run";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

const schema = z.object({
  month: z.string().regex(MONTH, "Give the month as yyyy-mm"),
  /** A preview writes nothing — it answers "what would this month cost". */
  action: z.enum(["preview", "generate"]).default("preview")
});

/** Every month that has been run, newest first. */
export async function GET() {
  try {
    const auth = await apiSession(can.viewPayroll);
    if ("response" in auth) return auth.response;

    await connectDb();
    const items = await PayrollRun.find({})
      .populate("generatedBy", "name").populate("approvedBy", "name").populate("paidBy", "name")
      .sort({ month: -1 }).limit(36).lean();

    return ok({ items, mayRun: can.runPayroll(auth.session.role), mayApprove: can.approvePayroll(auth.session.role) });
  } catch (error) {
    return fail(error);
  }
}

/**
 * Prepares a month.
 *
 * A preview and a generate work the figures out identically — the only
 * difference is whether they are written. A payroll somebody can see only by
 * committing to it is a payroll they will commit to without looking.
 *
 * Generating replaces the draft for that month entirely rather than patching
 * it: attendance gets corrected, a joiner is added, a salary is fixed, and the
 * month is simply built again. An approved month is refused, so figures the
 * company has committed to are never rewritten underneath anybody.
 */
export async function POST(request: Request) {
  try {
    const auth = await apiSession(can.runPayroll);
    if ("response" in auth) return auth.response;

    const { month, action } = schema.parse(await request.json());

    // Running a month before it has ended pays for days nobody has worked yet.
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    if (month > currentMonth) return badRequest("That month has not begun yet");

    await connectDb();
    const existing = await PayrollRun.findOne({ month }).select("status").lean() as { status: string } | null;

    if (action === "preview") {
      const built = await buildPayroll(month);
      return ok({ ...built, existingStatus: existing?.status ?? null, incomplete: month === currentMonth });
    }

    if (existing && existing.status !== "Draft") {
      return badRequest(`${month} has already been ${existing.status.toLowerCase()}. Reopen it before preparing it again.`);
    }

    const run = await saveDraftRun(month, auth.session.userId);
    await record({
      actor: auth.session.userId, action: "payroll.generated", entityType: "PayrollRun", entityId: run._id,
      metadata: { month, employees: run.totals?.employees, netPay: run.totals?.netPay, skipped: run.skipped?.length }
    });

    return ok(run, 201);
  } catch (error) {
    return fail(error);
  }
}
