import { connectDb } from "@/lib/db/mongoose";
import { SalesTeamOrder } from "@/models/SalesTeam";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok } from "@/lib/api";
import { loadCredentials, shiprocketToken } from "@/lib/sales/settings";
import { trackByAwb } from "@/lib/sales/shiprocket";
import { orderScope } from "@/lib/sales-team/access";
import { applyShipmentUpdate, recalculateIncentive } from "@/lib/sales-team/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Enough parcels to cover an executive's moving orders, few enough to finish inside a minute. */
const LIMIT = 40;

/**
 * Brings the signed-in person's moving parcels up to date, one courier scan
 * each — including the expected delivery day, which is what the "delivering
 * today" reminder is built on. The executive presses it in the morning instead
 * of waiting for tonight's pass.
 */
export async function POST() {
  try {
    const auth = await apiSession(can.placeSalesOrder);
    if ("response" in auth) return auth.response;
    await connectDb();

    const token = await shiprocketToken(await loadCredentials());
    if (!token) return badRequest("Shiprocket is not connected.", 502);

    const orders = await SalesTeamOrder.find({
      ...(orderScope(auth.session) ?? {}), cancelledAt: null,
      "shipment.awb": { $nin: [null, ""] }, "delivery.state": { $in: ["Awaiting", "In transit", "Undelivered"] }
    }).sort({ "shipment.checkedAt": 1 }).limit(LIMIT);

    let updated = 0;
    let failed = 0;
    for (const order of orders) {
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
    return ok({ checked: orders.length, updated, failed });
  } catch (error) {
    return fail(error);
  }
}
