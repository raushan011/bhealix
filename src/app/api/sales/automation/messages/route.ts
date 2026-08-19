import { connectDb } from "@/lib/db/mongoose";
import { SalesOutreachMessage } from "@/models/Sales";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { fail, ok, pageParams, OBJECT_ID } from "@/lib/api";
import { OUTREACH_STATUSES } from "@/lib/sales/automation";
import { like } from "@/lib/sales/leads";

/**
 * The log: every automated message, newest first, cut by status, rule, whether
 * they wrote back, and a half-remembered name or number.
 */
export async function GET(request: Request) {
  try {
    const auth = await apiSession(can.viewSales);
    if ("response" in auth) return auth.response;
    await connectDb();

    const { page, limit, skip, q } = pageParams(request.url);
    const params = new URL(request.url).searchParams;

    const where: Record<string, unknown> = {};
    const status = params.get("status");
    if (status && (OUTREACH_STATUSES as readonly string[]).includes(status)) where.status = status;
    const rule = params.get("rule");
    if (rule && OBJECT_ID.test(rule)) where.rule = rule;
    if (params.get("replied") === "yes") where.repliedAt = { $exists: true };
    if (params.get("replied") === "no") where.repliedAt = { $exists: false };
    if (q) {
      // A search that is all digits is a number; anything else is a name or a city.
      const digits = q.replace(/\D/g, "");
      where.$or = [{ leadName: like(q) }, { city: like(q) }, ...(digits ? [{ phone: like(digits) }] : [])];
    }

    const [items, total] = await Promise.all([
      SalesOutreachMessage.find(where).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      SalesOutreachMessage.countDocuments(where)
    ]);

    return ok({ items, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  } catch (error) {
    return fail(error);
  }
}
