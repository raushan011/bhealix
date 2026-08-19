import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { SalesOutreachReply } from "@/models/Sales";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { fail, ok, pageParams, OBJECT_ID } from "@/lib/api";
import { like } from "@/lib/sales/leads";

/** The inbox: what came back, newest first, or only what nobody has read. */
export async function GET(request: Request) {
  try {
    const auth = await apiSession(can.viewSales);
    if ("response" in auth) return auth.response;
    await connectDb();

    const { page, limit, skip, q } = pageParams(request.url);
    const params = new URL(request.url).searchParams;

    const where: Record<string, unknown> = {};
    if (params.get("seen") === "no") where.seen = false;
    if (q) {
      const digits = q.replace(/\D/g, "");
      where.$or = [{ leadName: like(q) }, { profileName: like(q) }, { text: like(q) }, ...(digits ? [{ phone: like(digits) }] : [])];
    }

    const [items, total] = await Promise.all([
      SalesOutreachReply.find(where).sort({ receivedAt: -1 }).skip(skip).limit(limit).lean(),
      SalesOutreachReply.countDocuments(where)
    ]);

    return ok({ items, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  } catch (error) {
    return fail(error);
  }
}

const seenSchema = z.object({
  /** Which to mark. Absent means every unread one. */
  ids: z.array(z.string().regex(OBJECT_ID)).max(200).optional()
});

/** Marks replies read. Reading is not a change to the business, so no audit line. */
export async function PATCH(request: Request) {
  try {
    const auth = await apiSession(can.viewSales);
    if ("response" in auth) return auth.response;
    await connectDb();

    const input = seenSchema.parse(await request.json().catch(() => ({})));
    const where = input.ids ? { _id: { $in: input.ids } } : { seen: false };
    const result = await SalesOutreachReply.updateMany(where, { $set: { seen: true } });
    return ok({ marked: result.modifiedCount });
  } catch (error) {
    return fail(error);
  }
}
