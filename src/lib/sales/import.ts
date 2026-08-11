import { amount, normaliseHeader, parseDate } from "./csv";
import { normaliseCode, parseCoupon } from "./coupons";
import { deliveryStateFrom } from "./delivery";
import type { DeliveryState } from "./constants";

/**
 * Turning a checkout export into attributed orders.
 *
 * The reason this exists: the coupons are applied in **Shiprocket's own
 * checkout** (Fastrr), and where an order lands afterwards depends on how the
 * store is wired. When the Shopify Admin API cannot see them, the checkout
 * dashboard still can — and its export already carries everything attribution
 * needs: the discount name, the discount total, what was paid, and the delivery
 * status.
 *
 * Column names are matched by alias rather than by position, because every
 * export names them differently and a fixed position is one added column away
 * from reading a discount as a total.
 *
 * Pure and tested. The route does the writing; everything here can be checked
 * against a literal.
 */

export const IMPORT_FIELDS = [
  "orderName", "placedAt", "couponCode", "discount", "total",
  "customerName", "customerPhone", "customerCity", "deliveryStatus", "items"
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

/**
 * What each column might be called. Longer, more specific aliases come first —
 * "discounttotal" must win over "total" when both are present.
 */
export const FIELD_ALIASES: Record<ImportField, string[]> = {
  orderName: ["orderid", "ordernumber", "orderno", "channelorderid", "ordername", "order", "referencenumber"],
  placedAt: ["orderdate", "createdat", "date", "placedon", "orderplacedat", "createdon"],
  couponCode: ["discountname", "couponcode", "coupon", "discountcode", "promocode", "offercode"],
  discount: ["discounttotal", "discountamount", "discountvalue", "totaldiscount", "discount"],
  total: ["ordertotal", "grandtotal", "totalamount", "netamount", "amountpaid", "payableamount", "amount", "total"],
  customerName: ["customername", "buyername", "name", "customer"],
  customerPhone: ["customerphone", "buyerphone", "phone", "mobile", "contact"],
  customerCity: ["customercity", "shippingcity", "city"],
  deliveryStatus: ["deliverystatus", "shipmentstatus", "orderstatus", "status"],
  items: ["items", "products", "productname", "lineitems", "itemname"]
};

export type Mapping = Partial<Record<ImportField, string>>;

/**
 * Which column is which.
 *
 * A header is claimed by the first field whose alias it matches, and a column
 * already claimed is never claimed twice — so "Discount Total" becomes the
 * discount rather than being taken again as the total.
 */
export function mapHeaders(headers: string[]): Mapping {
  const available = new Map(headers.map(header => [normaliseHeader(header), header]));
  const taken = new Set<string>();
  const mapping: Mapping = {};

  for (const field of IMPORT_FIELDS) {
    for (const alias of FIELD_ALIASES[field]) {
      const header = available.get(alias);
      if (header && !taken.has(header)) {
        mapping[field] = header;
        taken.add(header);
        break;
      }
    }
  }

  return mapping;
}

/** Everything the importer must have to write an order at all. */
export const REQUIRED_FIELDS: ImportField[] = ["orderName", "couponCode", "total"];

export const missingFields = (mapping: Mapping) => REQUIRED_FIELDS.filter(field => !mapping[field]);

export type ImportedOrder = {
  name: string;
  placedAt: Date;
  couponCode: string;
  /** What the coupon took off. */
  discount: number;
  /** What the customer paid, after the discount. */
  total: number;
  customer: { name?: string; phone?: string; city?: string };
  deliveryStatus?: string;
  delivery: DeliveryState;
  itemTitle: string;
};

export type ImportRowResult =
  | { ok: true; order: ImportedOrder }
  | { ok: false; reason: string };

/**
 * One row.
 *
 * `total` is read as the money that actually arrived, and the discount is added
 * back to reconstruct what the line was before it — which is the shape the
 * commission arithmetic expects, and makes an imported order price identically
 * to one pulled from Shopify:
 *
 *     kit 2,299 gross − 800 coupon = 1,499 paid → 30% = ₹450
 */
export function toOrder(row: Record<string, string>, mapping: Mapping, fallbackDate = new Date()): ImportRowResult {
  const read = (field: ImportField) => (mapping[field] ? row[mapping[field]!] ?? "" : "");

  const name = read("orderName").trim();
  if (!name) return { ok: false, reason: "no order id in this row" };

  const couponCode = normaliseCode(read("couponCode"));
  if (!couponCode) return { ok: false, reason: "no coupon on this order" };
  if (!parseCoupon(couponCode)) return { ok: false, reason: `"${couponCode}" is not a rep-shaped code` };

  const total = amount(read("total"));
  if (total <= 0) return { ok: false, reason: "nothing was paid on this order" };

  const discount = Math.abs(amount(read("discount")));
  const status = read("deliveryStatus");

  return {
    ok: true,
    order: {
      name: name.startsWith("#") ? name : `#${name}`,
      placedAt: parseDate(read("placedAt")) ?? fallbackDate,
      couponCode,
      discount,
      total,
      customer: {
        name: read("customerName") || undefined,
        phone: read("customerPhone") || undefined,
        city: read("customerCity") || undefined
      },
      deliveryStatus: status || undefined,
      delivery: deliveryStateFrom(status),
      itemTitle: read("items") || "Order"
    }
  };
}

export type ImportSummary = {
  rows: number;
  usable: number;
  skipped: { reason: string; count: number }[];
  /** Codes that look like a rep's but belong to nobody here. */
  unknownCoupons: string[];
  orders: ImportedOrder[];
};

/** The whole file, with every row that could not be used accounted for by reason. */
export function readImport(rows: Record<string, string>[], mapping: Mapping): ImportSummary {
  const orders: ImportedOrder[] = [];
  const reasons = new Map<string, number>();

  for (const row of rows) {
    const result = toOrder(row, mapping);
    if (result.ok) orders.push(result.order);
    else reasons.set(result.reason, (reasons.get(result.reason) ?? 0) + 1);
  }

  return {
    rows: rows.length,
    usable: orders.length,
    skipped: [...reasons].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    unknownCoupons: [],
    orders
  };
}
