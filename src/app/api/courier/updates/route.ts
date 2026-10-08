import { connectDb } from "@/lib/db/mongoose";
import { SalesTeamOrder } from "@/models/SalesTeam";
import { ok } from "@/lib/api";
import { loadCredentials, shiprocketToken } from "@/lib/sales/settings";
import { matchKey, searchShiprocketOrders } from "@/lib/sales/shiprocket";
import { readCourierUpdate, verifyCourierToken } from "@/lib/sales-team/courier-webhook";
import { findReplacement, REPLACEMENT_WINDOW_DAYS } from "@/lib/sales-team/shipment-match";
import { applyShipmentUpdate, recalculateIncentive } from "@/lib/sales-team/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Airway bills already looked for among unshipped team orders on this instance, so each scan of one parcel is not asked about again. */
const looked = new Set<string>();

/**
 * Shiprocket's tracking webhook: a parcel moved, so the sales order it belongs
 * to moves now — status, courier, expected day, delivery, and with it the
 * executive's incentive — instead of when somebody next opens a screen.
 *
 * The parcel is found by its airway bill, then its Shiprocket order, then the
 * name it is filed under. A parcel none of those find may be the copy the
 * office re-made in the shop and shipped in place of an executive's order
 * (#1806 for #1802): Shiprocket is asked who it is going to, and an unshipped
 * team order to that customer, for that amount, from just before, takes it.
 *
 * Always answers 200 once the token checks out — anything else and Shiprocket
 * retries, then disables the webhook. Parcels that are not the sales team's
 * (the affiliate side's) are simply ignored here.
 */
export async function POST(request: Request) {
  if (!verifyCourierToken(request.headers.get("x-api-key"), process.env.SHIPROCKET_WEBHOOK_TOKEN)) {
    return new Response("Unauthorised", { status: 401 });
  }

  let body: unknown;
  try { body = await request.json(); } catch { return ok({ ignored: "not JSON" }); }
  const update = readCourierUpdate(body);
  if (!update) return ok({ ignored: "no parcel" });

  try {
    await connectDb();
    const name = update.channelOrderId ? matchKey(update.channelOrderId).replace(/^#/, "") : "";
    const or: Record<string, unknown>[] = [];
    if (update.awb) or.push({ "shipment.awb": update.awb });
    if (update.shiprocketOrderId) or.push({ "shipment.shiprocketOrderId": update.shiprocketOrderId });
    if (name) or.push({ "shipment.channelOrderId": { $in: [name, `#${name}`] } }, { name: { $in: [`#${name}`, name] } }, { ref: name });

    let order = or.length ? await SalesTeamOrder.findOne({ $or: or }).sort({ placedAt: -1 }) : null;
    // A parcel already booked is only ever moved by its own airway bill.
    if (order?.shipment?.awb && order.shipment.awb !== update.awb) order = null;

    if (!order && update.awb && update.channelOrderId && !looked.has(update.awb)) {
      looked.add(update.awb);
      order = await replacedOrder(update.channelOrderId, update.awb);
      if (order) order.set("shipment.channelOrderId", update.channelOrderId);
    }
    if (!order) return ok({ ignored: "not a sales team parcel" });

    applyShipmentUpdate(order, update);
    recalculateIncentive(order);
    await order.save();
    return ok({ order: order.name, delivery: order.delivery?.state });
  } catch (error) {
    // Logged, not returned: a 5xx would only have Shiprocket retry and then switch the webhook off.
    console.error("courier webhook", error);
    return ok({ ignored: "error" });
  }
}

/** The unshipped team order a re-made copy was shipped in place of, when exactly one fits. */
async function replacedOrder(channelOrderId: string, awb: string) {
  const since = new Date(Date.now() - (REPLACEMENT_WINDOW_DAYS + 1) * 86_400_000);
  const waiting = await SalesTeamOrder.find({ cancelledAt: null, "shipment.awb": { $in: [null, ""] }, placedAt: { $gte: since } });
  if (!waiting.length) return null;

  const token = await shiprocketToken(await loadCredentials());
  if (!token) return null;
  const found = await searchShiprocketOrders(token, { search: channelOrderId, perPage: 5 });
  const row = found.items.find(item => item.awb === awb) ?? found.items.find(item => matchKey(item.channelOrderId) === matchKey(channelOrderId));
  if (!row) return null;

  const fits = waiting.filter(order => findReplacement(order, [{ ...row, awb }]));
  return fits.length === 1 ? fits[0] : null;
}
