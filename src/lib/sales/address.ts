import { addressOf, missingFields, type Address } from "./fulfilment";
import { shopifyConfig } from "./settings";
import { fetchOrder, mapOrder } from "./shopify";

/**
 * Getting a delivery address for an order that has not got one.
 *
 * Every order in this database predates the courier booking, and for all of
 * them the shipping address was thrown away on the way in — the sync only ever
 * kept the three fields the commission arithmetic reads (city, state, pin code),
 * because nothing here had ever needed to post anything. It keeps the whole
 * address now, but that only helps an order the sync has touched since.
 *
 * So the address is fetched on demand: the order is read back from Shopify, one
 * call, at the moment somebody is trying to book it. Shopify has had the address
 * all along.
 *
 * **It is written back.** The point is not to borrow the address for one
 * booking, but to stop asking: an order fetched once is an order that books
 * instantly next time, and a second attempt after a failure costs nothing.
 * Anything typed by a person is left alone, because a street corrected by hand
 * beats the one the checkout collected.
 */

type Settings = Parameters<typeof shopifyConfig>[0];

export type OrderWithAddress = {
  _id?: unknown;
  shopifyOrderId?: string | null;
  customer?: Address | null;
  set: (path: string, value: unknown) => void;
  save: () => Promise<unknown>;
};

/**
 * A resolver bound to one set of credentials, or null when Shopify is not
 * connected. Made once per batch rather than per order, so forty orders do not
 * re-read the settings document forty times.
 */
export function addressResolver(settings: Settings) {
  const config = shopifyConfig(settings);
  if (!config) return null;

  return async function resolve(order: OrderWithAddress): Promise<Address | null> {
    const shopifyOrderId = String(order.shopifyOrderId ?? "").trim();
    // An imported order has no Shopify id to ask about. Nothing to do, and not
    // a fault — somebody types the address in instead.
    if (!shopifyOrderId) return null;

    const raw = await fetchOrder(config, shopifyOrderId);
    if (!raw) return null;

    const { customer } = mapOrder(raw);
    const fetched: Address = {};
    for (const [field, value] of Object.entries(customer)) {
      // Only what is missing here. A field somebody corrected by hand is not
      // overwritten by the one the checkout happened to collect.
      if (String(value ?? "").trim() && !String((order.customer ?? {})[field as keyof Address] ?? "").trim()) {
        fetched[field as keyof Address] = value as string;
        order.set(`customer.${field}`, value);
      }
    }

    if (!Object.keys(fetched).length) return null;
    await order.save();
    return addressOf(order as { customer?: Address });
  };
}

/** Whether it is worth a call to Shopify at all: only when something is actually missing. */
export const needsAddress = (order: { customer?: Address | null }) =>
  missingFields(addressOf(order as { customer?: Address })).length > 0;
