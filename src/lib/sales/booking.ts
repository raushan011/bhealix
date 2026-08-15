import { IntegrationError } from "./http";
import {
  addressOf, blockedReason, buildAdhocOrder, missingFields, paymentModeOf, parcelValueOf, pickCourier,
  type Address, type BookableOrder, type CourierChoice, type Parcel
} from "./fulfilment";
import { assignAwb, createOrder, fetchShipmentFor, matchKeysFor, schedulePickup, serviceability } from "./shiprocket";
import type { ProcessResult } from "./types";

/**
 * One order, all the way from "somebody pressed Process" to a parcel with an
 * airway bill on it.
 *
 * The four Shiprocket calls in order, with the two decisions that are not
 * obvious sitting between them:
 *
 * 1. **Find before create.** A shop connected to Shiprocket as a channel pushes
 *    its own orders across, so the order this CRM is about to book may already
 *    be sitting there half-finished — booked, no airway bill. Creating it again
 *    would either be refused for a duplicate id or, worse, accepted: two
 *    parcels, two freights, one customer. So every form the order could be filed
 *    under (§ shiprocket `matchKeysFor`) is tried first, and a booking is only
 *    raised when none of them finds anything.
 *
 * 2. **A failure is a result, not an exception.** This is called in a loop over
 *    a selection, and the sixth order failing must not abandon the thirty-four
 *    behind it. Every failure comes back as a row with the reason on it, and is
 *    also written to the order, so a batch processed before lunch can be read
 *    after it.
 *
 * Nothing here touches commission. Booking a parcel decides nothing about money:
 * the delivery state stays whatever the courier last said, which for a parcel
 * that has not moved yet is `Awaiting`, and the commission follows the delivery
 * exactly as it did before (§4.4).
 */

/** The mongoose document, kept loose because the model itself is untyped. */
export type OrderDoc = BookableOrder & {
  _id: unknown;
  /** Both are how Shiprocket may already be filing this order — see `matchKeysFor`. */
  orderNumber?: number | null;
  shopifyOrderId?: string | null;
  customer?: Address;
  shipment?: Record<string, unknown>;
  set: (path: string, value: unknown) => void;
  save: () => Promise<unknown>;
};

export type BookingInput = {
  pickupLocation: string;
  /** The pin code that pickup address sits at — what serviceability is measured from. */
  pickupPincode: string;
  parcel: Parcel;
  courier: CourierChoice;
  schedulePickup: boolean;
  /** Typed in by the operator, for the fields the checkout never collected. */
  address?: Address | null;
  /**
   * Fills a missing address from the shop, for the orders that arrived before
   * this system kept one (§ address.ts). Absent when Shopify is not connected.
   */
  resolveAddress?: ((order: OrderDoc) => Promise<Address | null>) | null;
  actor: string;
};

export async function processOrder(token: string, order: OrderDoc, input: BookingInput): Promise<ProcessResult> {
  const name = String(order.name ?? "");
  const result = (over: Partial<ProcessResult>): ProcessResult => ({ orderId: String(order._id), name, ok: false, ...over });

  const blocked = blockedReason(order);
  if (blocked) return result({ error: blocked });

  let address = addressOf(order, input.address);

  /*
   * Every order placed before this system booked its own parcels has a city, a
   * state and a pin code and no street: those were the only three fields the
   * commission arithmetic ever needed, so they were the only three the sync
   * kept. Shopify has had the rest all along, so it is fetched — one call, at
   * the moment it is actually wanted, and written back so it is never fetched
   * for that order again.
   *
   * Before the refusal below rather than after it, or a batch of last month's
   * orders would report forty missing addresses that Shopify could have
   * supplied in forty seconds.
   */
  if (missingFields(address).length && input.resolveAddress) {
    try {
      // The resolver writes what it found onto the order and saves it, so the
      // address is simply read again rather than merged a second time here.
      if (await input.resolveAddress(order)) address = addressOf(order, input.address);
    } catch {
      // The shop being unreachable is not this order's fault, and the address
      // may already be complete enough. Fall through to the check below, which
      // says plainly what is still missing.
    }
  }

  const missing = missingFields(address);
  if (missing.length) return result({ error: `Cannot book without the ${missing.join(", ")}.` });

  try {
    /*
     * Whatever the operator typed is kept on the order, not just sent — the next
     * person to look at it should see the address it actually shipped to.
     *
     * Written a field at a time rather than by assigning the whole object.
     * `customer` and `shipment` are nested paths, and setting one wholesale
     * replaces every key under it: an address typed in here would silently drop
     * the email the checkout did collect, and a booking would drop the delivery
     * dates the sync had already written.
     */
    if (input.address) {
      for (const [field, value] of Object.entries(address)) order.set(`customer.${field}`, value);
    }

    const booked = await ensureBooked(token, order, input, address);
    const cod = paymentModeOf(order) === "COD";

    /*
     * The booking is written down the moment it exists, before an airway bill is
     * asked for.
     *
     * Those are two separate things at Shiprocket and the second fails on its
     * own — an empty wallet, a courier out of capacity. Saving only at the end
     * would leave an order that *is* booked over there looking untouched here,
     * and the next press would go looking for it all over again. Written now, a
     * failure half way through leaves the honest state instead: in Shiprocket,
     * no airway bill — which is a filter on the screen.
     */
    if (String(order.shipment?.shipmentId ?? "") !== booked.shipmentId) {
      write(order, {
        "shipment.shiprocketOrderId": booked.shiprocketOrderId,
        "shipment.shipmentId": booked.shipmentId,
        "shipment.pickupLocation": input.pickupLocation,
        "shipment.parcel": input.parcel
      });
      await order.save();
    }

    let awb = String(order.shipment?.awb ?? "").trim();
    let courierName = String(order.shipment?.courier ?? "").trim();
    let courierId = Number(order.shipment?.courierId ?? 0) || undefined;

    if (!awb) {
      const couriers = await serviceability(token, {
        pickupPincode: input.pickupPincode,
        deliveryPincode: String(address.pinCode ?? ""),
        weight: input.parcel.weight,
        cod,
        declaredValue: parcelValueOf(order)
      });

      const { courier, error } = pickCourier(couriers, input.courier);
      if (!courier) throw new IntegrationError("Shiprocket", error ?? "No courier could be chosen for this order.");

      const assignment = await assignAwb(token, booked.shipmentId, courier.id);
      awb = assignment.awb;
      courierName = assignment.courier || courier.name;
      courierId = assignment.courierId ?? courier.id;
    }

    // Only ever asked for once. A second request for the same shipment is an
    // error at Shiprocket rather than a no-op, and re-processing an order that
    // already has a pickup is a thing people do.
    const pickup = input.schedulePickup && !order.shipment?.pickupScheduledAt
      ? await schedulePickup(token, booked.shipmentId)
      : null;

    write(order, {
      "shipment.shiprocketOrderId": booked.shiprocketOrderId,
      "shipment.shipmentId": booked.shipmentId,
      "shipment.awb": awb,
      "shipment.courier": courierName,
      "shipment.courierId": courierId,
      "shipment.pickupLocation": input.pickupLocation,
      "shipment.parcel": input.parcel,
      "shipment.codAmount": cod ? parcelValueOf(order) : 0,
      ...(pickup ? { "shipment.pickupScheduledAt": pickup.scheduledAt, "shipment.pickupToken": pickup.token } : {}),
      "shipment.processedAt": new Date(),
      "shipment.processedBy": input.actor,
      // Cleared, not left: a reason for a failure that has since been fixed is
      // a red line on a row that shipped perfectly well.
      "shipment.lastError": undefined
    });
    await order.save();

    return result({ ok: true, awb, courier: courierName });
  } catch (error) {
    const message = error instanceof IntegrationError || error instanceof Error
      ? error.message
      : "Shiprocket could not book this order.";

    // Kept on the order as well as returned: a batch is read afterwards, not
    // watched, and the six that would not book have to still say why.
    try {
      order.set("shipment.lastError", message);
      await order.save();
    } catch {
      // The booking already failed; failing to write down why must not replace
      // the reason with a database error nobody can act on.
    }

    return result({ error: message });
  }
}

/** Several paths at once, each set on its own so a nested path is never replaced wholesale. */
function write(order: OrderDoc, values: Record<string, unknown>) {
  for (const [path, value] of Object.entries(values)) order.set(path, value);
}

/**
 * The order as Shiprocket knows it — found if it is already there, raised if it
 * is not. See the note on "find before create" above.
 */
async function ensureBooked(token: string, order: OrderDoc, input: BookingInput, address: Address) {
  const known = {
    shiprocketOrderId: String(order.shipment?.shiprocketOrderId ?? "").trim(),
    shipmentId: String(order.shipment?.shipmentId ?? "").trim()
  };
  if (known.shiprocketOrderId && known.shipmentId) return known;

  for (const key of matchKeysFor(order)) {
    const found = await fetchShipmentFor(token, key);
    if (!found) continue;
    if (found.shipmentId) return { shiprocketOrderId: found.shiprocketOrderId, shipmentId: found.shipmentId };

    /*
     * Shiprocket has the order but nothing to ship against it. Creating it again
     * would be refused for a duplicate id, and the message for that says nothing
     * useful — so the state is named instead, because the fix is over there.
     */
    throw new IntegrationError("Shiprocket",
      `Shiprocket already holds this order as ${found.shiprocketOrderId} but has no shipment against it. Open it in Shiprocket and add the parcel details, then process it again.`);
  }

  return await createOrder(token, buildAdhocOrder({
    order, address, parcel: input.parcel, pickupLocation: input.pickupLocation
  }));
}
