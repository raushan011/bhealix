import { httpJson, IntegrationError } from "@/lib/sales/http";
import { assertShopDomain, fetchOrder, type ShopifyConfig } from "@/lib/sales/shopify";
import type { buildShopifyOrder } from "./shopify-order";

/**
 * The two calls the sales team makes to Shopify: place an order, cancel one.
 * What can be sold, and at what price, is the handbook's catalogue — not the
 * shop's product list. The body of the order is built, and tested, in
 * `shopify-order.ts`.
 */

const endpoint = (config: ShopifyConfig, path: string, query = "") =>
  `https://${assertShopDomain(config.domain)}/admin/api/${config.apiVersion}/${path}${query ? `?${query}` : ""}`;
const headers = (config: ShopifyConfig) => ({ "X-Shopify-Access-Token": config.accessToken });

export type PlacedOrder = { id: string; name: string; orderNumber?: number };

/** Places the order in Shopify. Shopify's own refusal comes back as an `IntegrationError` in its own words. */
export async function placeShopifyOrder(config: ShopifyConfig, body: ReturnType<typeof buildShopifyOrder>): Promise<PlacedOrder> {
  try {
    const { data } = await httpJson<{ order?: { id: number | string; name?: string; order_number?: number } }>({
      service: "Shopify", url: endpoint(config, "orders.json"), method: "POST", headers: headers(config), body
    });
    if (!data.order?.id) throw new IntegrationError("Shopify", "Shopify accepted the request but sent no order back.");
    return { id: String(data.order.id), name: data.order.name ?? `#${data.order.order_number}`, orderNumber: data.order.order_number };
  } catch (error) {
    if (error instanceof IntegrationError && (error.status === 403 || error.status === 401)) {
      throw new IntegrationError("Shopify", "Shopify refused to create the order: the app has not been granted write_orders. Add it to the app in the Dev Dashboard, release a version, then press Reconnect with Shopify under Affiliate CRM → Settings.", error.status);
    }
    throw error;
  }
}

/**
 * Cancels the order in Shopify, restocking it. An order Shopify already shows as
 * cancelled is not an error — the state wanted is the state it is in.
 */
export async function cancelShopifyOrder(config: ShopifyConfig, orderId: string, reason: string): Promise<void> {
  try {
    await httpJson({
      service: "Shopify", url: endpoint(config, `orders/${encodeURIComponent(orderId)}/cancel.json`), method: "POST", headers: headers(config),
      body: { reason: "customer", email: false, restock: true, note: reason }
    });
  } catch (error) {
    const current = await fetchOrder(config, orderId).catch(() => null);
    if (current?.cancelled_at) return;
    throw error;
  }
}
