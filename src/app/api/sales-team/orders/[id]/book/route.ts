import { connectDb } from "@/lib/db/mongoose";
import { SalesTeamOrder, SalesTeamSettings } from "@/models/SalesTeam";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { record } from "@/lib/audit";
import { processOrder, type OrderDoc } from "@/lib/sales/booking";
import { IntegrationError } from "@/lib/sales/http";
import { loadCredentials, shiprocketToken } from "@/lib/sales/settings";
import { pickupLocations } from "@/lib/sales/shiprocket";
import { mayActOn, orderScope } from "@/lib/sales-team/access";
import { bookSchema } from "@/lib/sales-team/schemas";
import { loadTeamSettings, parcelOfOrder } from "@/lib/sales-team/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Up to six calls to Shiprocket for one order; a minute is the room the affiliate booking route is given too. */
export const maxDuration = 60;

/**
 * Books one sales order with Shiprocket: the order, a courier, an airway bill
 * and, if asked, a pickup.
 *
 * Exactly the booking the Affiliate CRM's processing screen does
 * (`lib/sales/booking.ts`), handed a team order instead — the field names were
 * kept identical so that it could be. The same rules therefore hold: find before
 * create, so a second press never raises a second parcel; a failure is written
 * onto the order and returned as a sentence rather than thrown; and nothing here
 * decides any money. The incentive moves only when the courier reports a
 * delivery.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.placeSalesOrder);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Unknown order");
    await connectDb();

    const input = bookSchema.parse(await request.json());
    const scope = orderScope(auth.session) ?? {};
    const order = await SalesTeamOrder.findOne({ _id: id, ...scope });
    if (!order) return badRequest("That order could not be found", 404);
    if (!mayActOn(auth.session, order.executive)) return badRequest("You do not have access to this action", 403);

    const settings = await loadCredentials();
    let token: string | null;
    try {
      token = await shiprocketToken(settings);
    } catch (error) {
      if (error instanceof IntegrationError) return badRequest(error.message, 502);
      throw error;
    }
    if (!token) return badRequest("Shiprocket is not connected yet. An administrator adds it under Affiliate CRM → Settings.", 502);

    let from;
    try {
      from = (await pickupLocations(token)).find(location => location.name === input.pickupLocation);
    } catch (error) {
      if (error instanceof IntegrationError) return badRequest(error.message, 502);
      throw error;
    }
    if (!from) return badRequest(`Shiprocket has no pickup address called "${input.pickupLocation}".`, 502);
    if (!from.pinCode) return badRequest(`The pickup address "${from.name}" has no pin code on it in Shiprocket.`, 502);

    // The administrator's carton at the weight this order's products come to —
    // never what the screen sent, so no booking can declare a lighter parcel.
    const { parcel } = parcelOfOrder(order, await loadTeamSettings());
    const result = await processOrder(token, order as unknown as OrderDoc, {
      pickupLocation: from.name,
      pickupPincode: from.pinCode,
      parcel,
      courier: { id: input.courierId, rule: input.courierRule },
      schedulePickup: input.schedulePickup,
      // A team order is typed in with its full address, so there is nothing to
      // fetch from the shop; an incomplete one reports what it is missing.
      resolveAddress: null,
      address: null,
      enforceParcel: true,
      actor: auth.session.userId
    });

    if (result.ok) {
      await SalesTeamSettings.updateOne({ key: "sales-team" }, {
        $set: { fulfilment: { pickupLocation: from.name, ...parcel, courierRule: input.courierRule, courierId: input.courierId, courierName: input.courierName } }
      }, { upsert: true });
      await record({
        actor: auth.session.userId,
        action: "team.order.booked",
        entityType: "SalesTeamOrder",
        entityId: order._id,
        metadata: { name: order.name, awb: result.awb, courier: result.courier, pickup: from.name }
      });
    }

    return result.ok ? ok(result) : badRequest(result.error ?? "Shiprocket could not book this order.", 502);
  } catch (error) {
    return fail(error);
  }
}
