import { amount, httpJson, IntegrationError } from "./http";
import { normaliseCode } from "./coupons";

/**
 * Reading orders out of Shopify.
 *
 * The Admin REST API rather than GraphQL: this pulls whole orders in pages of
 * 250 and nothing here benefits from choosing fields, so the simpler client wins.
 *
 * The part worth understanding is **discount allocation**. Shopify records, for
 * each line item, how much each discount code took off it — `discount_allocations`
 * points back into the order's `discount_applications` by index. That is what
 * lets a rep whose code only works on one product be paid on that product
 * without anybody maintaining a list of which product it was. Everything else in
 * this file is plumbing around getting that number out intact.
 */

export type ShopifyConfig = { domain: string; accessToken: string; apiVersion: string };

/**
 * The shop's `.myshopify.com` address, from whatever somebody had to hand.
 *
 * Asking for "the shop address" reliably gets one of three answers, because all
 * three are on screen when the question is asked:
 *
 * - the admin URL, `admin.shopify.com/store/vapvrf-0z` — the commonest, since
 *   that is the tab they are looking at;
 * - the bare store handle, `vapvrf-0z`;
 * - the address itself.
 *
 * All three are accepted and reduced to the same thing. The storefront domain
 * (`www.bhealix.com`) is deliberately *not* rewritten — there is no way to
 * derive the handle from it, and quietly passing it through to fail later is
 * worse than `assertShopDomain` saying so plainly.
 */
export function normaliseDomain(value: string): string {
  const trimmed = (value ?? "").trim().replace(/^https?:\/\//i, "").toLowerCase();
  if (!trimmed) return "";

  const fromAdminUrl = /^admin\.shopify\.com\/store\/([a-z0-9][a-z0-9-]*)/.exec(trimmed);
  if (fromAdminUrl) return `${fromAdminUrl[1]}.myshopify.com`;

  const host = trimmed.replace(/\/.*$/, "");
  if (!host) return "";
  return host.includes(".") ? host : `${host}.myshopify.com`;
}

/**
 * The Admin API answers on the `.myshopify.com` address and nowhere else — a
 * storefront domain returns the shop's *home page*, so the failure without this
 * is a confusing "answered with something that is not JSON" rather than the one
 * sentence that fixes it.
 */
export function assertShopDomain(domain: string): string {
  const host = normaliseDomain(domain);
  if (!host) throw new IntegrationError("Shopify", "Enter the shop address, like your-store.myshopify.com.");

  if (!host.endsWith(".myshopify.com")) {
    throw new IntegrationError("Shopify",
      `The Admin API answers on your .myshopify.com address, not ${host}. Open your Shopify admin and read the URL — admin.shopify.com/store/<handle> — then use <handle>.myshopify.com. Pasting that admin URL here works too.`);
  }
  return host;
}

const url = (config: ShopifyConfig, path: string, params: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") search.set(key, String(value));
  return `https://${normaliseDomain(config.domain)}/admin/api/${config.apiVersion}/${path}?${search}`;
};

const authHeaders = (config: ShopifyConfig) => ({ "X-Shopify-Access-Token": config.accessToken });

// ------------------------------------------------------------- the wire shapes

type ShopifyMoney = string | number | null;

type ShopifyDiscountApplication = {
  type?: string;
  code?: string;
  title?: string;
  target_type?: string;
};

type ShopifyLineItem = {
  id?: number | string;
  product_id?: number | string | null;
  variant_id?: number | string | null;
  sku?: string | null;
  title?: string;
  name?: string;
  quantity?: number;
  price?: ShopifyMoney;
  total_discount?: ShopifyMoney;
  discount_allocations?: { amount?: ShopifyMoney; discount_application_index?: number }[];
};

type ShopifyRefund = {
  refund_line_items?: { line_item_id?: number | string; subtotal?: ShopifyMoney; total_tax?: ShopifyMoney }[];
  transactions?: { kind?: string; status?: string; amount?: ShopifyMoney }[];
};

export type ShopifyOrder = {
  id: number | string;
  name?: string;
  order_number?: number;
  created_at?: string;
  updated_at?: string;
  cancelled_at?: string | null;
  financial_status?: string | null;
  currency?: string;
  total_price?: ShopifyMoney;
  gateway?: string | null;
  payment_gateway_names?: string[];
  customer?: { first_name?: string; last_name?: string; email?: string; phone?: string } | null;
  email?: string | null;
  phone?: string | null;
  shipping_address?: {
    name?: string; address1?: string; address2?: string; city?: string; province?: string; zip?: string;
    country?: string; phone?: string;
  } | null;
  discount_codes?: { code?: string }[];
  discount_applications?: ShopifyDiscountApplication[];
  line_items?: ShopifyLineItem[];
  refunds?: ShopifyRefund[];
};

// ------------------------------------------------------------------- fetching

/** Confirms the credentials answer, and says which shop they belong to. */
export async function verifyShop(config: ShopifyConfig): Promise<{ name: string; domain: string; currency: string }> {
  assertShopDomain(config.domain);
  if (!config.accessToken) {
    throw new IntegrationError("Shopify", "No access token is stored. Press Connect with Shopify to authorise the app — the token is issued from that. A legacy shpat_ token can still be pasted in instead.");
  }

  const { data } = await httpJson<{ shop?: { name?: string; myshopify_domain?: string; currency?: string } }>({
    service: "Shopify", url: url(config, "shop.json", {}), headers: authHeaders(config)
  });
  return {
    name: data.shop?.name ?? normaliseDomain(config.domain),
    domain: data.shop?.myshopify_domain ?? normaliseDomain(config.domain),
    currency: data.shop?.currency ?? "INR"
  };
}

/**
 * How many orders this token can actually see.
 *
 * The diagnostic that separates the three ways a sync comes back empty: a token
 * without `read_orders` sees none, a token without `read_all_orders` sees only
 * the last sixty days, and a correct token sees everything — in which case an
 * empty sync is about the window it asked for, not about permission.
 */
export async function countOrders(config: ShopifyConfig): Promise<number> {
  assertShopDomain(config.domain);
  const { data } = await httpJson<{ count?: number }>({
    service: "Shopify", url: url(config, "orders/count.json", { status: "any" }), headers: authHeaders(config)
  });
  return data.count ?? 0;
}

/** The `page_info` cursor out of Shopify's `Link` header, or nothing when the last page is in. */
function nextPageInfo(headers: Headers): string | undefined {
  const link = headers.get("link") ?? headers.get("Link");
  if (!link) return undefined;
  for (const part of link.split(",")) {
    if (!part.includes('rel="next"')) continue;
    const match = /[?&]page_info=([^&>]+)/.exec(part);
    if (match) return match[1];
  }
  return undefined;
}

/**
 * Every order touched since `updatedSince`, oldest first.
 *
 * Keyed on `updated_at` rather than `created_at` on purpose: a month-old order
 * that was refunded this morning has to come back through the sync, and a
 * created-at window would never see it again.
 *
 * `status=any` includes cancelled orders, which matters for the same reason —
 * a cancellation is news the commission needs.
 *
 * Note the paging loop drops every filter once it has a cursor. That is
 * Shopify's rule, not a choice: sending `page_info` alongside anything but
 * `limit` is rejected.
 */
export async function fetchOrders(config: ShopifyConfig, updatedSince: Date, maxPages = 40): Promise<ShopifyOrder[]> {
  assertShopDomain(config.domain);

  const orders: ShopifyOrder[] = [];
  let pageInfo: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const target = pageInfo
      ? url(config, "orders.json", { limit: 250, page_info: pageInfo })
      : url(config, "orders.json", { limit: 250, status: "any", updated_at_min: updatedSince.toISOString(), order: "updated_at asc" });

    const { data, headers } = await httpJson<{ orders?: ShopifyOrder[] }>({ service: "Shopify", url: target, headers: authHeaders(config) });
    orders.push(...(data.orders ?? []));

    pageInfo = nextPageInfo(headers);
    if (!pageInfo) break;
  }

  return orders;
}

// -------------------------------------------------------------------- mapping

export type MappedLine = {
  productId?: string;
  variantId?: string;
  sku?: string;
  title: string;
  quantity: number;
  gross: number;
  couponDiscount: number;
  otherDiscount: number;
  refunded: number;
};

export type MappedOrder = {
  shopifyOrderId: string;
  name: string;
  orderNumber?: number;
  placedAt: Date;
  currency: string;
  customer: {
    name?: string; email?: string; phone?: string;
    address1?: string; address2?: string; city?: string; state?: string; pinCode?: string; country?: string;
  };
  discountCodes: string[];
  items: MappedLine[];
  totals: { gross: number; discount: number; refunded: number; paid: number };
  financialStatus?: string;
  paymentMethod?: string;
  cancelledAt?: Date;
  fullyRefunded: boolean;
};

/** Every discount code on the order, upper-cased, in the order they were applied. */
export const codesOn = (order: ShopifyOrder): string[] =>
  (order.discount_codes ?? []).map(entry => normaliseCode(entry.code ?? "")).filter(Boolean);

/**
 * Turns one Shopify order into the shape the commission arithmetic reads,
 * splitting each line's discount into the part `couponCode` took off and the
 * part something else did.
 *
 * `couponCode` is the rep's code, decided by attribution before this is called.
 * Passing nothing means the order is unattributed, and every discount on it
 * counts as somebody else's.
 */
export function mapOrder(order: ShopifyOrder, couponCode?: string | null): MappedOrder {
  const wanted = couponCode ? normaliseCode(couponCode) : "";

  // Which entries in `discount_applications` are the rep's code. Allocations
  // point here by index, so this is how a line knows whose discount it carries.
  const ours = new Set<number>();
  (order.discount_applications ?? []).forEach((application, index) => {
    if (wanted && application.type === "discount_code" && normaliseCode(application.code ?? "") === wanted) ours.add(index);
  });

  const refundedByLine = refundsByLine(order);

  const items: MappedLine[] = (order.line_items ?? []).map(line => {
    const quantity = Number(line.quantity) || 0;
    const gross = amount(line.price) * quantity;

    let couponDiscount = 0;
    let allocated = 0;
    for (const allocation of line.discount_allocations ?? []) {
      const value = amount(allocation.amount);
      allocated += value;
      if (allocation.discount_application_index !== undefined && ours.has(allocation.discount_application_index)) couponDiscount += value;
    }

    // `total_discount` is the older, un-attributed figure. Trusted only when no
    // allocation was reported at all, so an order pulled from a shop that does
    // not record them still has the right money on it.
    const otherDiscount = Math.max(0, (allocated || amount(line.total_discount)) - couponDiscount);

    return {
      productId: line.product_id != null ? String(line.product_id) : undefined,
      variantId: line.variant_id != null ? String(line.variant_id) : undefined,
      sku: line.sku ?? undefined,
      title: line.title ?? line.name ?? "Item",
      quantity,
      gross,
      couponDiscount,
      otherDiscount,
      refunded: refundedByLine.get(String(line.id ?? "")) ?? 0
    };
  });

  const gross = items.reduce((total, line) => total + line.gross, 0);
  const discount = items.reduce((total, line) => total + line.couponDiscount + line.otherDiscount, 0);
  const refunded = items.reduce((total, line) => total + line.refunded, 0);
  const address = order.shipping_address ?? undefined;

  return {
    shopifyOrderId: String(order.id),
    name: order.name ?? `#${order.order_number ?? order.id}`,
    orderNumber: order.order_number,
    placedAt: order.created_at ? new Date(order.created_at) : new Date(),
    currency: order.currency ?? "INR",
    /*
     * The shipping address in full, and not only the three fields the commission
     * arithmetic ever looks at. The street lines are read by nothing here — they
     * are what the courier booking needs (§ fulfilment), and Shopify has already
     * sent them on every order. Storing them is the difference between an order
     * that books in one press and one somebody has to re-type from the shop.
     */
    customer: {
      name: [order.customer?.first_name, order.customer?.last_name].filter(Boolean).join(" ") || address?.name || undefined,
      email: order.customer?.email ?? order.email ?? undefined,
      phone: order.customer?.phone ?? order.phone ?? address?.phone ?? undefined,
      address1: address?.address1 ?? undefined,
      address2: address?.address2 ?? undefined,
      city: address?.city ?? undefined,
      state: address?.province ?? undefined,
      pinCode: address?.zip ?? undefined,
      country: address?.country ?? undefined
    },
    discountCodes: codesOn(order),
    items,
    totals: { gross, discount, refunded, paid: Math.max(0, gross - discount - refunded) },
    financialStatus: order.financial_status ?? undefined,
    paymentMethod: paymentMethodOf(order),
    cancelledAt: order.cancelled_at ? new Date(order.cancelled_at) : undefined,
    fullyRefunded: order.financial_status === "refunded"
  };
}

/**
 * The customer as the shop now reports them, without losing what somebody typed.
 *
 * A sync overwrites the order it re-reads, which is right for money and wrong
 * for an address. The street a shipping clerk typed in to get a parcel booked
 * was typed in *because* the checkout never collected one — so a plain overwrite
 * blanks it on the next pass, and the order that shipped on Tuesday cannot be
 * booked on Thursday.
 *
 * So a field the shop sends wins, and a field it does not send leaves what is
 * already there alone. There is no case where Shopify deliberately empties an
 * address: it either has one or it never did.
 */
export function mergeCustomer(existing: MappedOrder["customer"] | undefined | null, incoming: MappedOrder["customer"]): MappedOrder["customer"] {
  const merged = { ...(existing ?? {}) } as Record<string, string | undefined>;
  for (const [field, value] of Object.entries(incoming)) {
    if (String(value ?? "").trim()) merged[field] = value;
  }
  return merged as MappedOrder["customer"];
}

/**
 * What was refunded against each line.
 *
 * Only line refunds are allocated. A refund of shipping, or a goodwill credit
 * with no line behind it, reduces the order's takings but not what was paid for
 * the product — and it is the product the commission is a share of.
 */
function refundsByLine(order: ShopifyOrder): Map<string, number> {
  const byLine = new Map<string, number>();
  for (const refund of order.refunds ?? []) {
    for (const line of refund.refund_line_items ?? []) {
      const id = String(line.line_item_id ?? "");
      if (!id) continue;
      byLine.set(id, (byLine.get(id) ?? 0) + amount(line.subtotal) + amount(line.total_tax));
    }
  }
  return byLine;
}

/** "Cash on delivery" or the gateway's own name — worth knowing, since COD is what comes back. */
function paymentMethodOf(order: ShopifyOrder): string | undefined {
  const names = order.payment_gateway_names?.length ? order.payment_gateway_names : order.gateway ? [order.gateway] : [];
  if (!names.length) return undefined;
  const joined = names.join(", ");
  return /cash on delivery|\bcod\b/i.test(joined) ? "COD" : joined;
}
