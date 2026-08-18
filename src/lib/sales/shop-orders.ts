import { SalesOrder, SalesShopOrder } from "@/models/Sales";
import { attributeOrder } from "./coupons";
import { deliveryStateFrom } from "./delivery";
import { deliveryFromShopify, shopOrderFrom } from "./retarget";
import type { ShipmentUpdate } from "./shiprocket";
import { matchKey, matchKeysFor } from "./shiprocket";
import { codesOn, mapOrder, mergeCustomer, type ShopifyOrder } from "./shopify";

/**
 * Keeping the whole customer base current.
 *
 * Runs on the same pulls the affiliate sync already makes — every order Shopify
 * returns goes through here, attributed or not — so the retargeting list is as
 * fresh as the orders screen without a second schedule to watch. Nothing here
 * touches money: a shop order is a person to ring, not a commission.
 */

/**
 * Writes every order in a pull.
 *
 * Upserts keyed on Shopify's id, so the hour of overlap each pull re-reads is
 * harmless, and only the shop's half of the row is set — the calling desk's
 * half (`retarget`) is never in the `$set`, so a remark written between two
 * syncs is not blanked by the second one — and a number the desk corrected
 * lives there too (`retarget.phone`), out of the shop's reach. The address is
 * merged rather than replaced, as the attributed order's is, so a field the
 * shop stops sending is not lost.
 */
export async function recordShopOrders(
  orders: ShopifyOrder[],
  coupons: Map<string, string>
): Promise<{ written: number; keys: string[] }> {
  if (!orders.length) return { written: 0, keys: [] };

  const ids = orders.map(order => String(order.id));
  const existing = new Map(
    (await SalesShopOrder.find({ shopifyOrderId: { $in: ids } }).select("shopifyOrderId customer delivery.source").lean() as unknown as
      { shopifyOrderId: string; customer?: Record<string, string | undefined>; delivery?: { source?: string } }[])
      .map(row => [row.shopifyOrderId, row])
  );

  // Which of these a partner brought in, so the row can point at the fuller
  // record and carry the partner for the filter.
  const attributed = await SalesOrder.find({ shopifyOrderId: { $in: ids } }).select("shopifyOrderId rep couponCode delivery shipment").lean() as unknown as
    { _id: unknown; shopifyOrderId: string; rep?: unknown; couponCode?: string;
      delivery?: { state?: string; at?: Date }; shipment?: { status?: string; courier?: string; awb?: string; deliveredAt?: Date; checkedAt?: Date } }[];
  const byShopify = new Map(attributed.map(row => [row.shopifyOrderId, row]));

  const keys = new Set<string>();
  const now = new Date();

  const operations = orders.map(raw => {
    const match = attributeOrder(codesOn(raw), coupons);
    const mapped = mapOrder(raw, match?.code);
    const fields = shopOrderFrom(mapped, raw.fulfillment_status);
    const before = existing.get(fields.shopifyOrderId);
    const linked = byShopify.get(fields.shopifyOrderId);
    keys.add(fields.customerKey);

    const set: Record<string, unknown> = {
      name: fields.name,
      orderNumber: fields.orderNumber,
      placedAt: fields.placedAt,
      customerKey: fields.customerKey,
      customer: mergeCustomer(before?.customer, fields.customer),
      items: fields.items,
      products: fields.products,
      total: fields.total,
      paymentMethod: fields.paymentMethod,
      financialStatus: fields.financialStatus,
      fulfilment: fields.fulfilment,
      cancelledAt: fields.cancelledAt,
      discountCodes: fields.discountCodes,
      order: linked?._id ?? null,
      rep: linked?.rep ?? null,
      couponCode: linked?.couponCode ?? match?.code ?? null,
      syncedAt: now
    };

    // The attributed record already knows what the courier said; copy it so
    // the two screens never disagree about the same parcel. Failing that, the
    // shop's own word on the parcel — but never over a courier report already
    // on the row, which is the more direct source.
    const shopify = deliveryFromShopify(raw.fulfillments);
    if (linked?.delivery?.state && linked.delivery.state !== "Awaiting") {
      set["delivery.state"] = linked.delivery.state;
      set["delivery.status"] = linked.shipment?.status;
      set["delivery.courier"] = linked.shipment?.courier;
      set["delivery.awb"] = linked.shipment?.awb;
      set["delivery.deliveredAt"] = linked.shipment?.deliveredAt;
      set["delivery.checkedAt"] = linked.shipment?.checkedAt;
      set["delivery.source"] = "Shiprocket";
    } else if (shopify && before?.delivery?.source !== "Shiprocket") {
      set["delivery.state"] = shopify.state;
      set["delivery.status"] = shopify.status;
      set["delivery.courier"] = shopify.courier;
      set["delivery.awb"] = shopify.awb;
      set["delivery.deliveredAt"] = shopify.state === "Delivered" ? shopify.at : undefined;
      set["delivery.checkedAt"] = now;
      set["delivery.source"] = "Shopify";
    }

    return {
      updateOne: {
        filter: { shopifyOrderId: fields.shopifyOrderId },
        update: { $set: set, $setOnInsert: { "retarget.status": "Not called", "retarget.contactCount": 0, "retarget.remarkCount": 0 } },
        upsert: true
      }
    };
  });

  await SalesShopOrder.bulkWrite(operations, { ordered: false });
  await recountCustomers([...keys]);
  return { written: operations.length, keys: [...keys] };
}

/**
 * How many orders each customer has, written onto every one of their rows.
 *
 * Cached rather than joined because it is a filter ("repeat customers") on a
 * list somebody scrolls, and a `$lookup` per row on every page is the wrong
 * price for a number that changes only when the sync runs.
 */
export async function recountCustomers(keys: string[]) {
  if (!keys.length) return;
  const counts = await SalesShopOrder.aggregate<{ _id: string; orders: number }>([
    { $match: { customerKey: { $in: keys } } },
    { $group: { _id: "$customerKey", orders: { $sum: 1 } } }
  ]);
  if (!counts.length) return;
  await SalesShopOrder.bulkWrite(
    counts.map(row => ({ updateMany: { filter: { customerKey: row._id }, update: { $set: { customerOrders: row.orders } } } })),
    { ordered: false }
  );
}

/**
 * What the courier said about orders nobody's coupon brought in.
 *
 * The shipment pass already has every update Shiprocket returned for the
 * window; the attributed orders take theirs, and this hands the rest to the
 * shop orders they belong to. Only rows that could still change are walked —
 * a parcel delivered in March is not asked about again.
 */
export async function applyShipmentsToShopOrders(updates: ShipmentUpdate[], from: string): Promise<number> {
  if (!updates.length) return 0;
  const byKey = new Map(updates.map(update => [matchKey(update.channelOrderId), update]));

  const candidates = await SalesShopOrder.find({
    placedAt: { $gte: new Date(`${from}T00:00:00`) },
    "delivery.state": { $nin: ["Delivered", "RTO", "Returned", "Cancelled", "Lost"] }
  }).select("name orderNumber shopifyOrderId").lean() as { _id: unknown; name?: string; orderNumber?: number; shopifyOrderId?: string }[];

  const operations = [];
  for (const row of candidates) {
    const update = matchKeysFor(row).map(key => byKey.get(key)).find(Boolean);
    if (!update) continue;
    operations.push({
      updateOne: {
        filter: { _id: row._id },
        update: { $set: {
          "delivery.state": deliveryStateFrom(update.status, update.statusCode),
          "delivery.status": update.status,
          "delivery.courier": update.courier,
          "delivery.awb": update.awb,
          "delivery.deliveredAt": update.deliveredAt,
          "delivery.checkedAt": new Date(),
          "delivery.source": "Shiprocket"
        } }
      }
    });
  }

  if (operations.length) await SalesShopOrder.bulkWrite(operations, { ordered: false });
  return operations.length;
}
