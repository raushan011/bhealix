import { Types } from "mongoose";
import { connectDb } from "@/lib/db/mongoose";
import { SalesOrder } from "@/models/Sales";
import { apiPartner } from "@/lib/auth/partner";
import { fail, ok, pageParams } from "@/lib/api";
import { COMMISSION_STATUSES, DELIVERY_STATES } from "@/lib/sales/constants";
import { commissionForPartner } from "@/lib/sales/commission-payment";
import { normaliseCode } from "@/lib/sales/coupons";
import { trackingHeadline } from "@/lib/sales/tracking";

/**
 * The orders one rep's coupons brought in.
 *
 * The filter is built from the session and nothing else. There is deliberately
 * no `rep` parameter to omit, mis-spell or forget to validate: the only way to
 * reach this route is with an affiliate cookie, and the id in that cookie is the
 * only id that ever reaches the query. Every other filter the browser can send —
 * a coupon, a delivery state, a date range — narrows that set and can never
 * widen it, because they are merged into a filter that already names the rep.
 *
 * Each row carries the same one-line summary the detail screen opens with, so a
 * rep scanning forty orders reads sentences rather than decoding two badges.
 */
export async function GET(request: Request) {
  try {
    const auth = await apiPartner();
    if ("response" in auth) return auth.response;
    await connectDb();

    const { page, limit, skip, q } = pageParams(request.url);
    const params = new URL(request.url).searchParams;

    // The rep is set first and never from user input. Everything below narrows.
    const filter: Record<string, unknown> = { rep: new Types.ObjectId(String(auth.rep._id)) };

    if (q) {
      const safe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [{ name: new RegExp(safe, "i") }, { couponCode: new RegExp(safe, "i") }];
    }

    /*
     * A rep may filter by one of their own codes. Restricted to codes they
     * actually hold rather than passed through: without that, `?coupon=DIWALI25`
     * would be answered with an empty list, which is harmless, but the habit of
     * putting an unchecked string from a browser into a query is not.
     */
    const coupon = normaliseCode(params.get("coupon") ?? "");
    if (coupon && (auth.rep.coupons ?? []).some(held => normaliseCode(held.code ?? "") === coupon)) {
      filter.couponCode = coupon;
    }

    const delivery = params.get("delivery");
    if (delivery && (DELIVERY_STATES as readonly string[]).includes(delivery)) filter["delivery.state"] = delivery;

    const status = params.get("status");
    if (status && (COMMISSION_STATUSES as readonly string[]).includes(status)) filter["commission.status"] = status;

    const from = params.get("from"), to = params.get("to");
    if (from || to) {
      filter.placedAt = {
        ...(from ? { $gte: new Date(`${from}T00:00:00`) } : {}),
        ...(to ? { $lte: new Date(`${to}T23:59:59.999`) } : {})
      };
    }

    const [orders, total, summary] = await Promise.all([
      SalesOrder.find(filter)
        // Only the fields the list draws. A rep's screen has no use for the
        // Shopify order id or the sync bookkeeping, and the smallest payload
        // that answers the question is the right one over a phone connection.
        .select("name placedAt couponCode customer items totals paymentMethod financialStatus shipment delivery commission source")
        .sort({ placedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      SalesOrder.countDocuments(filter),
      // Over everything the filter matched, not the page on screen — the same
      // contract the admin order list has.
      SalesOrder.aggregate([
        { $match: filter },
        { $group: { _id: null, revenue: { $sum: "$totals.paid" }, commission: { $sum: "$commission.amount" } } }
      ])
    ]);

    return ok({
      items: orders.map(order => ({ ...commissionForPartner(order as { commission?: { payment?: { paidBy?: unknown } } }), headline: trackingHeadline(order as never) })),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
      summary: { revenue: Math.round(summary[0]?.revenue ?? 0), commission: Math.round(summary[0]?.commission ?? 0) }
    });
  } catch (error) {
    return fail(error);
  }
}
