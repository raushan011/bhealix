import { connectDb } from "@/lib/db/mongoose";
import { Payslip } from "@/models/Payroll";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";

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
    return ok({ items });
  } catch (error) {
    return fail(error);
  }
}
