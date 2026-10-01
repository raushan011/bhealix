import { connectDb } from "@/lib/db/mongoose";
import { SalesTeamOrder } from "@/models/SalesTeam";
import { apiSession } from "@/lib/auth/guard";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { IntegrationError } from "@/lib/sales/http";
import { loadCredentials, shiprocketToken } from "@/lib/sales/settings";
import { trackByAwb } from "@/lib/sales/shiprocket";
import { orderScope } from "@/lib/sales-team/access";
import { applyShipmentUpdate, recalculateIncentive } from "@/lib/sales-team/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where one parcel is, scan by scan — asked because somebody is on the phone
 * about it.
 *
 * What comes back is also written onto the order, through the same
 * `applyShipmentUpdate` and `recalculateIncentive` the nightly pass uses, so
 * the executive cannot see "Delivered" on the tracking card while their
 * incentive still says it is waiting for delivery.
 */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    const scope = orderScope(auth.session);
    if (!scope) return badRequest("You do not have access to the sales team's orders", 403);
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Unknown order");
    await connectDb();

    const order = await SalesTeamOrder.findOne({ _id: id, ...scope });
    if (!order) return badRequest("That order could not be found", 404);
    const awb = String(order.shipment?.awb ?? "").trim();
    if (!awb) return badRequest("This order has no airway bill yet. Book it with the courier first.");

    const token = await shiprocketToken(await loadCredentials());
    if (!token) return badRequest("Shiprocket is not connected.", 502);

    let tracking;
    try {
      tracking = await trackByAwb(token, awb);
    } catch (error) {
      if (error instanceof IntegrationError) return badRequest(error.message, 502);
      throw error;
    }

    applyShipmentUpdate(order, {
      awb,
      courier: tracking.courier,
      status: tracking.status,
      statusCode: tracking.statusCode,
      deliveredAt: tracking.deliveredAt
    });
    recalculateIncentive(order);
    await order.save();

    return ok({ tracking, delivery: order.delivery?.state, incentive: order.incentive?.status });
  } catch (error) {
    return fail(error);
  }
}
