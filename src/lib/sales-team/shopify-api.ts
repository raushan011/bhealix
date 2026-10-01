import { httpJson, IntegrationError } from "@/lib/sales/http";
import { assertShopDomain, fetchOrder, type ShopifyConfig } from "@/lib/sales/shopify";
import type { buildShopifyOrder } from "./shopify-order";

/**
 * The three calls the sales team makes to Shopify: list what can be sold, place
 * an order, cancel one. The body of the order is built, and tested, in
 * `shopify-order.ts`.
 */

const endpoint = (config: ShopifyConfig, path: string, query = "") =>
  `https://${assertShopDomain(config.domain)}/admin/api/${config.apiVersion}/${path}${query ? `?${query}` : ""}`;
const headers = (config: ShopifyConfig) => ({ "X-Shopify-Access-Token": config.accessToken });

export type SellableVariant = {
  /** The variant id — what an order line names. */
  id: string;
  productId: string;
  name: string;
  sku?: string;
  price: number;
  mrp?: number;
  /** Units the shop says it holds; absent where the shop does not track stock for it. */
  stock?: number;
};

type WireProduct = {
  id: number | string; title?: string; status?: string;
  variants?: { id: number | string; title?: string; sku?: string | null; price?: string; compare_at_price?: string | null; inventory_quantity?: number; inventory_management?: string | null }[];
};

/**
 * Every active product's variants, as the order form lists them — one row per
 * thing a customer can actually be sent. A product with a single "Default
 * Title" variant reads as just the product.
 */
export async function sellableVariants(config: ShopifyConfig, maxPages = 8): Promise<SellableVariant[]> {
  const rows: SellableVariant[] = [];
  let next: string | null = endpoint(config, "products.json", "status=active&limit=250&fields=id,title,status,variants");

  for (let page = 0; next && page < maxPages; page++) {
    const result: { data: { products?: WireProduct[] }; headers: Headers } = await httpJson<{ products?: WireProduct[] }>({ service: "Shopify", url: next, headers: headers(config) });
    const { data } = result;
    for (const product of data.products ?? []) {
      for (const variant of product.variants ?? []) {
        const variantName = variant.title && variant.title !== "Default Title" ? ` — ${variant.title}` : "";
        rows.push({
          id: String(variant.id),
          productId: String(product.id),
          name: `${product.title ?? "Product"}${variantName}`,
          sku: variant.sku || undefined,
          price: Number(variant.price) || 0,
          mrp: Number(variant.compare_at_price) || undefined,
          stock: variant.inventory_management ? Number(variant.inventory_quantity ?? 0) : undefined
        });
      }
    }
    // Shopify pages with a Link header; the next page's URL is the cursor.
    const link: string = result.headers.get("link") ?? "";
    next = /<([^>]+)>;\s*rel="next"/.exec(link)?.[1] ?? null;
  }
  return rows.sort((left, right) => left.name.localeCompare(right.name));
}

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
