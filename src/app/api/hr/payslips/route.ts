import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { Payslip } from "@/models/Payroll";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { record } from "@/lib/audit";
import { buildPayroll, savePayslipFor } from "@/lib/hr/payroll-run";

/**
 * Payslips, for whoever is asking.
 *
 * With no `employee` the answer is the caller's own, which is what a rep on
 * their phone wants and the only thing they are entitled to. Asking about
 * somebody else needs the HR desk's authority, and asking about somebody else
 * while not having it is refused rather than quietly answered with your own.
 *
 * A draft is never returned to the person it concerns. Until a month is
 * approved the figures are still being corrected, and showing somebody a salary
 * that then changes causes a conversation nobody needs.
 */
export async function GET(request: Request) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;

    const params = new URL(request.url).searchParams;
    const requested = params.get("employee");
    const employee = requested ?? auth.session.userId;
    if (!OBJECT_ID.test(employee)) return badRequest("Invalid employee reference");

    const own = employee === auth.session.userId;
    if (!own && !can.viewPayroll(auth.session.role)) {
      return badRequest("You do not have access to these payslips", 403);
    }

    await connectDb();
    const filter: Record<string, unknown> = { employee };
    if (own && !can.viewPayroll(auth.session.role)) filter.status = { $in: ["Approved", "Paid"] };
    if (params.get("month")) filter.month = params.get("month");

    const items = await Payslip.find(filter).sort({ month: -1 }).limit(36).lean();
    return ok({ items, mayPrepare: can.runPayroll(auth.session.role) });
  } catch (error) {
    return fail(error);
  }
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

const prepareSchema = z.object({
  employee: z.string().regex(OBJECT_ID, "Invalid employee reference"),
  month: z.string().regex(MONTH, "Give the month as yyyy-mm"),
  /** A preview writes nothing — it answers "what would this person be paid". */
  action: z.enum(["preview", "generate"]).default("preview")
});

/**
 * Prepares one person's payslip for one month.
 *
 * The whole-month run remains the ordinary way to pay everybody, and this does
 * not replace it. It answers the case the run cannot: somebody whose salary was
 * set after the month was prepared, a joiner added late, one figure corrected —
 * where preparing the month again would restate every other payslip in it,
 * including the ones already checked.
 *
 * The payslip joins that month's run, so approval and payment stay one decision
 * about one month rather than a scatter of individual slips, and the run's
 * totals are recounted around it. HR prepares; the administrator still approves.
 */
export async function POST(request: Request) {
  try {
    const auth = await apiSession(can.runPayroll);
    if ("response" in auth) return auth.response;

    const { employee, month, action } = prepareSchema.parse(await request.json());

    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    if (month > currentMonth) return badRequest("That month has not begun yet");

    await connectDb();

    if (action === "preview") {
      const built = await buildPayroll(month, { employee });
      return ok({
        month,
        payslip: built.payslips[0] ?? null,
        reason: built.payslips.length ? null : built.skipped[0]?.reason ?? "There is nothing to pay for that month",
        incomplete: month === currentMonth
      });
    }

    const result = await savePayslipFor(month, employee, auth.session.userId);
    if (!result.ok) return badRequest(result.error);

    await record({
      actor: auth.session.userId, action: "payroll.payslip.prepared", entityType: "Payslip",
      entityId: result.payslip._id,
      metadata: { month, employee, netPay: result.payslip.netPay }
    });

    return ok({ payslip: result.payslip, run: result.run._id }, 201);
  } catch (error) {
    return fail(error);
  }
}
