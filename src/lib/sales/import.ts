import { amount, normaliseHeader, parseDate } from "./csv";
import { normaliseCode } from "./coupons";
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
  "orderName", "platformOrderId", "placedAt", "couponCode", "discount", "total",
  "customerName", "customerLastName", "customerPhone", "customerCity", "deliveryStatus", "refunded", "items"
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

/**
 * What each column might be called, most specific alias first.
 *
 * "discounttotal" must beat "total", and "orderfulfillmentstatus" must beat
 * "status", or the wrong column is read as money. The Fastrr checkout export's
 * own names are in here — `clientorderid`, `discountdata`, `orderamount` —
 * because that is the file this is actually pointed at.
 */
export const FIELD_ALIASES: Record<ImportField, string[]> = {
  orderName: ["clientorderid", "orderid", "ordernumber", "orderno", "channelorderid", "ordername", "referencenumber", "order"],
  /**
   * The shop's own id for the order, when the export carries one. Kept because
   * it is what the Shopify sync keys on: without it, importing an order and
   * later syncing the same one from Shopify would make two.
   */
  platformOrderId: ["platformorderid", "shopifyorderid", "channelid", "platformid"],
  placedAt: ["orderdate", "createdat", "date", "placedon", "orderplacedat", "createdon"],
  couponCode: ["discountdata", "discountname", "couponcode", "coupon", "discountcode", "promocode", "offercode"],
  discount: ["discounttotal", "discountamount", "discountvalue", "totaldiscount", "discount"],
  total: ["orderamount", "ordertotal", "grandtotal", "totalamount", "netamount", "amountpaid", "payableamount", "amount", "total"],
  customerName: ["firstname", "customername", "buyername", "name", "customer"],
  customerLastName: ["lastname", "surname"],
  customerPhone: ["mobileno", "customerphone", "buyerphone", "phone", "mobile", "contact"],
  customerCity: ["customercity", "shippingcity", "city"],
  deliveryStatus: ["orderfulfillmentstatus", "deliverystatus", "shipmentstatus", "fulfillmentstatus", "orderstatus", "status"],
  refunded: ["refundedamount", "refund", "refunded"],
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
  /** The shop's own order id, where the export carries one. */
  platformOrderId?: string;
  placedAt: Date;
  couponCode: string;
  /** What the coupon took off, where the export says. Often it does not. */
  discount: number;
  /** What the customer was charged, after the discount. */
  total: number;
  refunded: number;
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
 * `total` is the money the customer was charged **after** the coupon came off,
 * which is what the commission is a share of. Where the export also names the
 * discount, it is added back so the line reads as it did before — the shape a
 * Shopify order arrives in — and where it does not, the total stands on its own
 * and the answer is the same either way:
 *
 *     kit  2,299 gross − 800 coupon = 1,499 charged → 30% = ₹450
 *     kit          (discount unknown) 1,499 charged → 30% = ₹450
 *
 * A code that is not name-then-digits is **not** rejected: a rep may be given a
 * coupon called anything, and which rule applies is decided by the rule they
 * were issued under, not by the letters in the code. Only the codes belonging
 * to no rep at all are dropped, and that happens in the route where the reps
 * are known.
 */
export function toOrder(row: Record<string, string>, mapping: Mapping, fallbackDate = new Date()): ImportRowResult {
  const read = (field: ImportField) => (mapping[field] ? row[mapping[field]!] ?? "" : "");

  const name = read("orderName").trim().replace(/^["']|["']$/g, "");
  if (!name) return { ok: false, reason: "no order id in this row" };

  const couponCode = normaliseCode(read("couponCode"));
  if (!couponCode) return { ok: false, reason: "no coupon on this order" };

  const total = amount(read("total"));
  if (total <= 0) return { ok: false, reason: "nothing was charged on this order" };

  const status = read("deliveryStatus");
  const platformOrderId = read("platformOrderId").trim();
  const lastName = read("customerLastName").trim();
  const firstName = read("customerName").trim();

  return {
    ok: true,
    order: {
      name: name.startsWith("#") ? name : `#${name}`,
      platformOrderId: platformOrderId || undefined,
      placedAt: parseDate(read("placedAt")) ?? fallbackDate,
      couponCode,
      discount: Math.abs(amount(read("discount"))),
      total,
      refunded: Math.abs(amount(read("refunded"))),
      customer: {
        name: [firstName, lastName].filter(Boolean).join(" ") || undefined,
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
