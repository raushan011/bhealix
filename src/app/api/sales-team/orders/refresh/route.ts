import { connectDb } from "@/lib/db/mongoose";
import { SalesTeamOrder } from "@/models/SalesTeam";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok } from "@/lib/api";
import { loadCredentials, shiprocketToken } from "@/lib/sales/settings";
import { trackByAwb } from "@/lib/sales/shiprocket";
import { orderScope } from "@/lib/sales-team/access";
import { applyShipmentUpdate, findTeamShipment, recalculateIncentive, UNBOOKED_LOOKBACK_DAYS } from "@/lib/sales-team/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Enough parcels to cover an executive's moving orders, few enough to finish inside a minute. */
const LIMIT = 40;
/** Orders not booked yet, looked up by name — each can take a few calls, so fewer of them. */
const UNBOOKED_LIMIT = 15;
/** An automatic refresh leaves alone what was checked this recently. */
const FRESH_MS = 10 * 60_000;
/** Stop starting new lookups after this, so the answer always arrives inside `maxDuration`. */
const BUDGET_MS = 45_000;

/**
 * Brings the signed-in person's orders up to date with Shiprocket:
 *
 * - every moving parcel, one courier scan each — including the expected
 *   delivery day, which is what the "delivering today" reminder is built on;
 * - every order not booked yet, looked up in Shiprocket by its order name — the
 *   office ships executives' orders, often from Shiprocket's own panel, and the
 *   order must show its airway bill and status here the moment it ships.
 *
 * The executive's screens call it on their own as they open (`?auto=1`, which
 * skips anything checked in the last ten minutes); the Refresh button forces it.
 */
export async function POST(request: Request) {
  try {
    const auth = await apiSession(can.placeSalesOrder);
    if ("response" in auth) return auth.response;
    await connectDb();

    const token = await shiprocketToken(await loadCredentials());
    if (!token) return badRequest("Shiprocket is not connected.", 502);

    const auto = new URL(request.url).searchParams.get("auto") === "1";
    const scope = { ...(orderScope(auth.session) ?? {}), cancelledAt: null };
    const stale = auto ? { $or: [{ "shipment.checkedAt": null }, { "shipment.checkedAt": { $lt: new Date(Date.now() - FRESH_MS) } }] } : {};
    const started = Date.now();
    const inBudget = () => Date.now() - started < BUDGET_MS;

    const [moving, unbooked] = await Promise.all([
      SalesTeamOrder.find({
        ...scope, ...stale,
        "shipment.awb": { $nin: [null, ""] }, "delivery.state": { $in: ["Awaiting", "In transit", "Undelivered"] }
      }).sort({ "shipment.checkedAt": 1 }).limit(LIMIT),
      SalesTeamOrder.find({
        ...scope, ...stale,
        "shipment.awb": { $in: [null, ""] }, placedAt: { $gte: new Date(Date.now() - UNBOOKED_LOOKBACK_DAYS * 86_400_000) }
      }).sort({ "shipment.checkedAt": 1, placedAt: -1 }).limit(UNBOOKED_LIMIT)
    ]);

    let updated = 0;
    let failed = 0;
    let shipped = 0;

    // Not booked here: has the office shipped it from Shiprocket?
    for (const order of unbooked) {
      if (!inBudget()) break;
      try {
        const found = await findTeamShipment(token, order);
        if (found) {
          applyShipmentUpdate(order, found);
          recalculateIncentive(order);
          if (found.awb) shipped++;
          updated++;
        } else {
          // Remembered as looked at, so the next automatic pass asks about another order first.
          order.set("shipment.checkedAt", new Date());
        }
        await order.save();
      } catch {
        failed++;
      }
    }

    for (const order of moving) {
      if (!inBudget()) break;
      try {
        const tracking = await trackByAwb(token, String(order.shipment.awb));
        applyShipmentUpdate(order, {
          awb: tracking.awb, courier: tracking.courier, status: tracking.status, statusCode: tracking.statusCode,
          deliveredAt: tracking.deliveredAt, expectedDelivery: tracking.expectedDelivery
        });
        recalculateIncentive(order);
        await order.save();
        updated++;
      } catch {
        failed++;
      }
    }
    return ok({ checked: moving.length + unbooked.length, updated, failed, shipped });
  } catch (error) {
    return fail(error);
  }
}
