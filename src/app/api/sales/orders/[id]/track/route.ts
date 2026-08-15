import { connectDb } from "@/lib/db/mongoose";
import { SalesOrder } from "@/models/Sales";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { recalculateCommission } from "@/lib/sales/commission";
import { deliveryStateFrom } from "@/lib/sales/delivery";
import { IntegrationError } from "@/lib/sales/http";
import { holdDaysOf, loadCredentials, rulesOf, shiprocketToken } from "@/lib/sales/settings";
import { trackByAwb } from "@/lib/sales/shiprocket";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where one parcel actually is, asked because somebody is on the telephone.
 *
 * The nightly sync reads every order's status and is what keeps commission in
 * step; this is one order, now, with the courier's own scan history rather than
 * a single word. The two agree by construction, because what comes back here is
 * put through the same `deliveryStateFrom` and the same `recalculateCommission`
 * the sync uses — a desk that can see "Delivered" on the courier's page while
 * this system still says "Awaiting" is a desk that stops trusting the system.
 *
 * Note what that is *not*: it is the courier's own report, read the same way it
 * is read every night. It is not the manual delivery override, which is a
 * person overruling the courier and stays with `manageSales` (§7.9).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.processOrders);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Not a valid order id");
    await connectDb();

    const order = await SalesOrder.findById(id);
    if (!order) return badRequest("No such order", 404);

    const awb = String(order.shipment?.awb ?? "").trim();
    if (!awb) return badRequest("This order has no airway bill yet, so there is nothing to track. Process it first.");

    const settings = await loadCredentials();
    const token = await shiprocketToken(settings);
    if (!token) return badRequest("Shiprocket is not connected. Add the API user under Sales settings.", 502);

    try {
      const tracking = await trackByAwb(token, awb);

      // Only when the courier actually said something. A parcel with no scans
      // yet must not have its state rewritten to "Awaiting" over the top of
      // whatever the last sync knew.
      if (tracking.status || tracking.statusCode != null) {
        const reported = deliveryStateFrom(tracking.status, tracking.statusCode);
        const before = order.delivery.reported;

        order.set("shipment.status", tracking.status);
        order.set("shipment.statusCode", tracking.statusCode);
        order.set("shipment.deliveredAt", tracking.deliveredAt ?? order.shipment?.deliveredAt);
        order.set("shipment.checkedAt", new Date());
        order.set("shipment.courier", tracking.courier || order.shipment?.courier);
        order.delivery.reported = reported;
        if (before !== reported) order.delivery.at = new Date();

        recalculateCommission(order, rulesOf(settings), { holdDays: holdDaysOf(settings) });
        await order.save();
      }

      return ok({
        tracking,
        delivery: order.delivery,
        commission: { status: order.commission?.status, amount: order.commission?.amount }
      });
    } catch (error) {
      if (error instanceof IntegrationError) return badRequest(error.message, 502);
      throw error;
    }
  } catch (error) {
    return fail(error);
  }
}
