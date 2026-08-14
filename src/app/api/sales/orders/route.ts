import { Types } from "mongoose";
import { connectDb } from "@/lib/db/mongoose";
import { SalesOrder } from "@/models/Sales";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { fail, ok, pageParams, OBJECT_ID } from "@/lib/api";
import { COMMISSION_STATUSES, DELIVERY_STATES } from "@/lib/sales/constants";
import { normaliseCode } from "@/lib/sales/coupons";

/**
 * Every attributed order, filtered the way the screens ask about them.
 *
 * Only orders a rep's coupon brought in are stored at all — an order with no
 * affiliate code is somebody else's business and is skipped by the sync — so
 * there is no "unattributed" filter here to write.
 */
export async function GET(request: Request) {
  try {
    const auth = await apiSession(can.viewSales);
    if ("response" in auth) return auth.response;
    await connectDb();

    const { page, limit, skip, q } = pageParams(request.url);
    const params = new URL(request.url).searchParams;

    // Conditions needing their own `$or` are collected into `$and`, so none of
    // them can quietly overwrite another (§11).
    const and: Record<string, unknown>[] = [];
    const filter: Record<string, unknown> = {};

    if (q) and.push({ $or: [
      { name: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") },
      { couponCode: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") },
      { "customer.name": new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }
    ] });

    const rep = params.get("rep");
    if (rep && OBJECT_ID.test(rep)) filter.rep = new Types.ObjectId(rep);

    /*
     * One exact coupon code, as opposed to the fuzzy `q` above.
     *
     * "Which orders did PRIYA30 bring in" is a different question from "search
     * for priya", and the difference matters when a rep holds two codes and is
     * asking about one of them. An exact match on the indexed `couponCode` also
     * costs nothing, where the regex is a collection scan.
     */
    const coupon = normaliseCode(params.get("coupon") ?? "");
    if (coupon) filter.couponCode = coupon;

    const delivery = params.get("delivery");
    if (delivery && (DELIVERY_STATES as readonly string[]).includes(delivery)) filter["delivery.state"] = delivery;

    const status = params.get("status");
    if (status && (COMMISSION_STATUSES as readonly string[]).includes(status)) filter["commission.status"] = status;

    if (params.get("attention") === "1") filter["commission.needsReversal"] = true;

    const from = params.get("from"), to = params.get("to");
    if (from || to) {
      filter.placedAt = {
        ...(from ? { $gte: new Date(`${from}T00:00:00`) } : {}),
        ...(to ? { $lte: new Date(`${to}T23:59:59.999`) } : {})
      };
    }

    const where = and.length ? { ...filter, $and: and } : filter;

    const [items, total, summary] = await Promise.all([
      SalesOrder.find(where).sort({ placedAt: -1 }).skip(skip).limit(limit).populate("rep", "name code").lean(),
      SalesOrder.countDocuments(where),
      // The summary covers the whole filtered set, not the page on screen —
      // the same contract the invoice list has.
      SalesOrder.aggregate([
        { $match: where },
        { $group: { _id: null, revenue: { $sum: "$totals.paid" }, commission: { $sum: "$commission.amount" } } }
      ])
    ]);

    return ok({
      items,
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
      summary: { revenue: Math.round(summary[0]?.revenue ?? 0), commission: Math.round(summary[0]?.commission ?? 0) }
    });
  } catch (error) {
    return fail(error);
  }
}
