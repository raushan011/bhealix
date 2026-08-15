import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { SalesOrder, SalesSettings } from "@/models/Sales";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { record } from "@/lib/audit";
import { addressResolver } from "@/lib/sales/address";
import { processOrder, type OrderDoc } from "@/lib/sales/booking";
import { COURIER_RULES, PROCESS_BATCH } from "@/lib/sales/constants";
import { normaliseParcel } from "@/lib/sales/fulfilment";
import { IntegrationError } from "@/lib/sales/http";
import { loadCredentials, shiprocketToken } from "@/lib/sales/settings";
import { pickupLocations } from "@/lib/sales/shiprocket";
import type { ProcessResult } from "@/lib/sales/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * A minute, rather than the ten seconds a function is given by default.
 *
 * Five orders is up to thirty calls to Shiprocket, and being cut off halfway
 * through is the one outcome with a real cost: parcels booked at the courier
 * with nothing written down here about them. Sixty is the ceiling on Vercel's
 * smallest plan, and `PROCESS_BATCH` is sized to sit well inside it.
 */
export const maxDuration = 60;

const addressSchema = z.object({
  name: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(20).optional(),
  email: z.string().trim().max(160).optional(),
  address1: z.string().trim().max(200).optional(),
  address2: z.string().trim().max(200).optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  pinCode: z.string().trim().max(10).optional(),
  country: z.string().trim().max(60).optional()
});

const schema = z.object({
  orderIds: z.array(z.string().regex(OBJECT_ID)).min(1).max(PROCESS_BATCH),
  pickupLocation: z.string().trim().min(1),
  parcel: z.object({
    weight: z.number().positive().max(50),
    length: z.number().positive().max(200),
    breadth: z.number().positive().max(200),
    height: z.number().positive().max(200)
  }),
  /** A named courier, or the rule to choose one per order by. */
  courierId: z.number().int().positive().optional(),
  courierName: z.string().trim().max(80).optional(),
  courierRule: z.enum(COURIER_RULES).default("recommended"),
  schedulePickup: z.boolean().default(false),
  /** Only honoured for a single order — a batch shares no address. */
  address: addressSchema.optional()
});

/**
 * Booking orders with the courier, which until now was done by hand in
 * Shiprocket's own panel.
 *
 * One route for one order and for forty, because they are the same work: the
 * browser sends the selection in chunks of `PROCESS_BATCH` and reports as each
 * chunk comes back. That bound is what keeps a serverless function inside its
 * wall clock — each order costs up to four calls to somebody else's API — and it
 * is why a batch of two hundred is a progress bar rather than a timeout with
 * half the orders written and no way to tell which half.
 *
 * Nothing here is a transaction and nothing needs to be. Each order is booked
 * and saved on its own; a failure in the sixth leaves the five before it booked,
 * which is exactly right — they *are* booked, at the courier, and pretending
 * otherwise by rolling back this database would be the one state that is
 * genuinely wrong.
 */
export async function POST(request: Request) {
  try {
    const auth = await apiSession(can.processOrders);
    if ("response" in auth) return auth.response;
    await connectDb();

    const input = schema.parse(await request.json());
    const parcel = normaliseParcel(input.parcel);

    const settings = await loadCredentials();
    let token: string | null;
    try {
      token = await shiprocketToken(settings);
    } catch (error) {
      if (error instanceof IntegrationError) return badRequest(error.message, 502);
      throw error;
    }
    if (!token) return badRequest("Shiprocket is not connected. Add the API user's email and password under Sales settings.", 502);

    /*
     * The pickup address is resolved once for the whole batch rather than per
     * order: it is the same warehouse for all of them, and its pin code is what
     * every serviceability check is measured from.
     */
    let from;
    try {
      const locations = await pickupLocations(token);
      from = locations.find(location => location.name === input.pickupLocation);
      if (!from) return badRequest(`Shiprocket has no pickup address called "${input.pickupLocation}".`, 502);
      if (!from.pinCode) return badRequest(`The pickup address "${from.name}" has no pin code on it in Shiprocket.`, 502);
    } catch (error) {
      if (error instanceof IntegrationError) return badRequest(error.message, 502);
      throw error;
    }

    // Fills in an address for the orders that arrived before this system kept
    // one. Null when Shopify is not connected, in which case an incomplete
    // order simply reports what it is missing.
    const resolve = addressResolver(settings);

    const results: ProcessResult[] = [];
    for (const id of input.orderIds) {
      const order = await SalesOrder.findById(id) as OrderDoc | null;
      if (!order) {
        results.push({ orderId: id, name: "", ok: false, error: "This order is no longer here." });
        continue;
      }

      results.push(await processOrder(token, order, {
        pickupLocation: from.name,
        pickupPincode: from.pinCode,
        parcel,
        courier: { id: input.courierId, rule: input.courierRule },
        schedulePickup: input.schedulePickup,
        // Bound once for the whole batch: forty orders must not re-read the
        // settings document forty times to learn the same shop address.
        resolveAddress: resolve,
        // A typed-in address belongs to one order. Sending a batch through with
        // one would put every parcel on the same doorstep.
        address: input.orderIds.length === 1 ? input.address : null,
        actor: auth.session.userId
      }));
    }

    const booked = results.filter(result => result.ok);
    if (booked.length) {
      // What worked becomes the default for next time, so the carton and the
      // warehouse are typed once rather than every morning.
      await SalesSettings.updateOne({ key: "sales" }, {
        $set: {
          fulfilment: {
            pickupLocation: from.name,
            ...parcel,
            courierRule: input.courierRule,
            courierId: input.courierId,
            courierName: input.courierName
          }
        }
      });

      await record({
        actor: auth.session.userId,
        action: "sales.orders.processed",
        entityType: "SalesOrder",
        entityId: booked.length === 1 ? booked[0].orderId : `${booked.length} orders`,
        metadata: {
          orders: booked.map(result => result.name),
          courier: input.courierName ?? input.courierRule,
          pickup: from.name,
          failed: results.length - booked.length
        }
      });
    }

    return ok({ results, booked: booked.length, failed: results.length - booked.length });
  } catch (error) {
    return fail(error);
  }
}
