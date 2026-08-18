import { z } from "zod";
import { DELIVERY_STATES, type DeliveryState } from "./constants";
import { REMARK_CHANNELS, whatsappNumber } from "./leads";
import type { MappedOrder, ShopifyFulfillment } from "./shopify";

/**
 * Ringing every customer the shop has ever had.
 *
 * The affiliate scheme reads only the orders a partner's coupon brought in.
 * Retargeting reads *every* order — the whole customer base — because a
 * customer who bought the kit in March and never came back is the cheapest
 * sale the company will make this month, and the only way to make it is to
 * ring them.
 *
 * So each Shopify order becomes a row somebody can call: who bought what,
 * when, whether it arrived, and underneath it a thread of what was said each
 * time somebody rang. Pure here — the model, the sync and the routes import
 * from this file, and the screen imports the same words for its filters.
 */

// --------------------------------------------------------------- the status

/**
 * Where a customer stands with the calling desk, on this order.
 *
 * Deliberately not the lead statuses next door: a lead is a shopfront that
 * has never heard of the company, and a customer is somebody who has already
 * paid it once. "Reordered" is the outcome the whole screen exists for, and
 * "Do not call" is the one that has to be respected on every later pass.
 */
export const RETARGET_STATUSES = ["Not called", "No answer", "Call back", "Interested", "Reordered", "Not interested", "Do not call"] as const;
export type RetargetStatus = (typeof RETARGET_STATUSES)[number];

export function retargetTone(status: string): "success" | "info" | "warn" | "danger" | "neutral" | "brand" {
  switch (status) {
    case "Reordered": return "success";
    case "Interested": return "brand";
    case "Call back": return "info";
    case "No answer": return "warn";
    case "Not interested": case "Do not call": return "danger";
    default: return "neutral";
  }
}

/** The things a retargeting call actually ends in, one tap each. */
export const RETARGET_PRESETS: readonly { label: string; text: string; status?: RetargetStatus }[] = [
  { label: "No answer", text: "Rang — no answer.", status: "No answer" },
  { label: "Call back", text: "Reached them, asked to call back later.", status: "Call back" },
  { label: "Interested", text: "Interested — asked about the offer and prices.", status: "Interested" },
  { label: "Reordered", text: "Placed a repeat order on the call.", status: "Reordered" },
  { label: "Not interested", text: "Not interested at the moment.", status: "Not interested" },
  { label: "Do not call", text: "Asked not to be called again.", status: "Do not call" },
  { label: "Wrong number", text: "Wrong number — could not reach the customer." }
];

// --------------------------------------------------------------- the row

/**
 * The same person across orders, so "has bought before" is answerable.
 *
 * Phone first, because it is what the calling desk dials and what a customer
 * types the same way at every checkout; email when there is no phone; and the
 * order's own id as a last resort so a row is never keyless. Normalised through
 * `whatsappNumber` so `098999 43298` and `+91 98999 43298` are one customer.
 */
export function customerKeyOf(customer: { phone?: string | null; email?: string | null }, orderId: string): string {
  const phone = whatsappNumber(customer.phone);
  if (phone) return `p:${phone}`;
  const email = (customer.email ?? "").trim().toLowerCase();
  if (email) return `e:${email}`;
  return `o:${orderId}`;
}

/** Shopify's own word for the parcel, reduced to the three the filter offers. */
export const FULFILMENT_STATES = ["Fulfilled", "Partial", "Unfulfilled"] as const;
export type FulfilmentState = (typeof FULFILMENT_STATES)[number];

export function fulfilmentStateOf(status: string | null | undefined): FulfilmentState {
  switch ((status ?? "").toLowerCase()) {
    case "fulfilled": return "Fulfilled";
    case "partial": return "Partial";
    default: return "Unfulfilled";
  }
}

/**
 * What the shop itself knows about the parcel, reduced to our delivery states.
 *
 * Shopify's `shipment_status` is written back by the shipping app, so for most
 * orders it says the same thing Shiprocket would — and it is there for every
 * order, however old, where the Shiprocket feed is only ever pulled for a
 * recent window. Used when Shiprocket has not spoken; a courier's own report,
 * when there is one, still wins.
 *
 * A cancelled fulfilment is skipped, and the newest live one is read, because
 * an order re-shipped after a failed attempt has two and the second is the one
 * that matters.
 */
export function deliveryFromShopify(fulfillments: ShopifyFulfillment[] | undefined | null):
  { state: DeliveryState; status: string; courier?: string; awb?: string; at?: Date } | null {
  const live = (fulfillments ?? [])
    .filter(entry => (entry.status ?? "").toLowerCase() !== "cancelled" && entry.shipment_status)
    .sort((a, b) => new Date(b.updated_at ?? b.created_at ?? 0).getTime() - new Date(a.updated_at ?? a.created_at ?? 0).getTime());
  const latest = live[0];
  if (!latest?.shipment_status) return null;

  const status = latest.shipment_status.toLowerCase();
  const state: DeliveryState | null =
    status === "delivered" ? "Delivered"
    : status === "attempted_delivery" || status === "failure" ? "Undelivered"
    : ["in_transit", "out_for_delivery", "confirmed", "ready_for_pickup", "label_printed", "label_purchased"].includes(status) ? "In transit"
    : null;
  if (!state) return null;

  return {
    state,
    status: latest.shipment_status,
    courier: latest.tracking_company ?? undefined,
    awb: latest.tracking_number ?? undefined,
    at: latest.updated_at ? new Date(latest.updated_at) : undefined
  };
}

/** One Shopify order, as the retargeting row stores it. */
export type ShopOrderFields = {
  shopifyOrderId: string;
  name: string;
  orderNumber?: number;
  placedAt: Date;
  customerKey: string;
  customer: MappedOrder["customer"];
  items: { title: string; quantity: number; sku?: string }[];
  /** Titles, de-duplicated — what the product filter matches on. */
  products: string[];
  total: number;
  paymentMethod?: string;
  financialStatus?: string;
  fulfilment: FulfilmentState;
  cancelledAt?: Date | null;
  discountCodes: string[];
};

export function shopOrderFrom(mapped: MappedOrder, fulfillmentStatus: string | null | undefined): ShopOrderFields {
  return {
    shopifyOrderId: mapped.shopifyOrderId,
    name: mapped.name,
    orderNumber: mapped.orderNumber,
    placedAt: mapped.placedAt,
    customerKey: customerKeyOf(mapped.customer, mapped.shopifyOrderId),
    customer: mapped.customer,
    items: mapped.items.map(item => ({ title: item.title, quantity: item.quantity, sku: item.sku })),
    products: [...new Set(mapped.items.map(item => item.title.trim()).filter(Boolean))],
    total: Math.round(mapped.totals.paid),
    paymentMethod: mapped.paymentMethod,
    financialStatus: mapped.financialStatus,
    fulfilment: fulfilmentStateOf(fulfillmentStatus),
    cancelledAt: mapped.cancelledAt ?? null,
    discountCodes: mapped.discountCodes
  };
}

// ------------------------------------------------------------ the filters

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH = /^\d{4}-\d{2}$/;

/**
 * Every way the list can be narrowed, read off the query string.
 *
 * Kept as one function so the list, the count, the summary and the export all
 * answer the same question — a screen whose export has more rows than its
 * table is a screen nobody trusts. Each parameter is checked against a closed
 * list or a shape before it reaches the query; nothing from a browser goes into
 * a `$match` as it arrived.
 */
export function shopOrderFilter(params: URLSearchParams, now = new Date()): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  const and: Record<string, unknown>[] = [];

  const q = (params.get("q") ?? "").trim();
  if (q) {
    const safe = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const digits = q.replace(/\D/g, "");
    and.push({ $or: [
      { name: safe }, { "customer.name": safe }, { "customer.email": safe }, { "customer.city": safe },
      ...(digits.length >= 4 ? [
        { "customer.phone": new RegExp(digits.split("").join("\\D?")) },
        { "retarget.phone": new RegExp(digits.split("").join("\\D?")) }
      ] : [])
    ] });
  }

  // When the order was placed: a month, or a from/to range. A month wins when
  // both are sent, because it is the coarser and more deliberate choice.
  const month = params.get("month");
  const from = params.get("from"), to = params.get("to");
  if (month && ISO_MONTH.test(month)) {
    const [year, mm] = month.split("-").map(Number);
    filter.placedAt = { $gte: new Date(year, mm - 1, 1), $lt: new Date(year, mm, 1) };
  } else if ((from && ISO_DAY.test(from)) || (to && ISO_DAY.test(to))) {
    filter.placedAt = {
      ...(from && ISO_DAY.test(from) ? { $gte: new Date(`${from}T00:00:00`) } : {}),
      ...(to && ISO_DAY.test(to) ? { $lte: new Date(`${to}T23:59:59.999`) } : {})
    };
  }

  const status = params.get("status");
  if (status && (RETARGET_STATUSES as readonly string[]).includes(status)) filter["retarget.status"] = status;

  // "Delivered" is Shiprocket's word where the parcel was tracked, and the
  // shop's fulfilment where it was not; the two are offered side by side rather
  // than blurred into one, because they are not the same fact.
  const delivery = params.get("delivery");
  if (delivery && (DELIVERY_STATES as readonly string[]).includes(delivery)) filter["delivery.state"] = delivery;
  if (delivery === "Untracked") filter["delivery.state"] = { $in: [null, ""] };

  const fulfilment = params.get("fulfilment");
  if (fulfilment && (FULFILMENT_STATES as readonly string[]).includes(fulfilment)) filter.fulfilment = fulfilment;

  const payment = params.get("payment");
  if (payment === "COD") filter.paymentMethod = "COD";
  if (payment === "Prepaid") filter.paymentMethod = { $nin: ["COD", null, ""] };

  const cancelled = params.get("cancelled");
  if (cancelled === "yes") filter.cancelledAt = { $ne: null };
  if (cancelled === "no") filter.cancelledAt = null;

  const city = (params.get("city") ?? "").trim();
  if (city) filter["customer.city"] = new RegExp(`^${city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");

  const product = (params.get("product") ?? "").trim();
  if (product) filter.products = product;

  // Attributed to a partner, to a named partner, or brought in by nobody.
  const partner = params.get("partner");
  if (partner === "any") filter.rep = { $ne: null };
  if (partner === "none") filter.rep = null;
  if (partner && /^[a-f\d]{24}$/i.test(partner)) filter.rep = partner;
  const coupon = (params.get("coupon") ?? "").trim().toUpperCase();
  if (coupon) filter.discountCodes = coupon;

  // Repeat customers: more than one order under the same phone or email.
  const repeat = params.get("repeat");
  if (repeat === "yes") filter.customerOrders = { $gt: 1 };
  if (repeat === "no") filter.customerOrders = { $lte: 1 };

  // Whether anybody has written anything, and what the last call was filed under.
  const remarks = params.get("remarks");
  if (remarks === "none") filter["retarget.remarkCount"] = { $in: [0, null] };
  if (remarks === "any") filter["retarget.remarkCount"] = { $gt: 0 };
  const channel = params.get("channel");
  if (channel && (REMARK_CHANNELS as readonly string[]).includes(channel)) filter["retarget.lastChannel"] = channel;

  const contacted = params.get("contacted");
  if (contacted === "never") filter["retarget.lastContactedAt"] = null;
  if (contacted === "ever") filter["retarget.lastContactedAt"] = { $ne: null };
  const contactedBefore = params.get("contactedBefore");
  if (contactedBefore && ISO_DAY.test(contactedBefore)) {
    and.push({ $or: [{ "retarget.lastContactedAt": null }, { "retarget.lastContactedAt": { $lt: new Date(`${contactedBefore}T00:00:00`) } }] });
  }

  const followUp = params.get("followUp");
  if (followUp === "due") filter["retarget.nextFollowUpAt"] = { $lte: now };
  if (followUp === "upcoming") filter["retarget.nextFollowUpAt"] = { $gt: now };
  if (followUp === "none") filter["retarget.nextFollowUpAt"] = null;

  const minTotal = Number(params.get("minTotal"));
  const maxTotal = Number(params.get("maxTotal"));
  if (minTotal > 0 || maxTotal > 0) {
    filter.total = { ...(minTotal > 0 ? { $gte: minTotal } : {}), ...(maxTotal > 0 ? { $lte: maxTotal } : {}) };
  }

  return and.length ? { ...filter, $and: and } : filter;
}

/** How the list is ordered. Newest order first unless somebody asks otherwise. */
export function shopOrderSort(sort: string | null): Record<string, 1 | -1> {
  switch (sort) {
    case "oldest": return { placedAt: 1, _id: 1 };
    case "followUp": return { "retarget.nextFollowUpAt": 1, placedAt: -1 };
    case "leastContacted": return { "retarget.lastContactedAt": 1, placedAt: -1 };
    case "total": return { total: -1, placedAt: -1 };
    case "name": return { "customer.name": 1, placedAt: -1 };
    default: return { placedAt: -1, _id: -1 };
  }
}

export const RETARGET_SORTS: readonly { value: string; label: string }[] = [
  { value: "newest", label: "Newest order first" },
  { value: "oldest", label: "Oldest order first" },
  { value: "leastContacted", label: "Least recently called" },
  { value: "followUp", label: "Follow-up due first" },
  { value: "total", label: "Biggest order first" },
  { value: "name", label: "Customer name" }
];

// --------------------------------------------------------------- the writes

const remarkText = z.string().trim().min(2, "Write what was said").max(1000, "A remark is a line or two, not a report");

export const retargetRemarkSchema = z.object({
  text: remarkText,
  channel: z.enum(REMARK_CHANNELS).default("Call"),
  status: z.enum(RETARGET_STATUSES).optional(),
  /** `yyyy-mm-dd`, or null to clear one. */
  nextFollowUp: z.string().regex(ISO_DAY).nullable().optional()
});

export const retargetRemarkEditSchema = z.object({
  text: remarkText.optional(),
  channel: z.enum(REMARK_CHANNELS).optional()
}).refine(input => Object.keys(input).length > 0, "Nothing to change");

export const retargetUpdateSchema = z.object({
  status: z.enum(RETARGET_STATUSES).optional(),
  notes: z.string().trim().max(1000).optional(),
  nextFollowUp: z.string().regex(ISO_DAY).nullable().optional(),
  /** The number the shop had was wrong and somebody found the right one. */
  phone: z.string().trim().max(30).optional()
}).refine(input => Object.keys(input).length > 0, "Nothing to change");

/** The last instant of `yyyy-mm-dd`, so a follow-up "on the 12th" is due all that day. */
export const followUpDate = (iso: string) => new Date(`${iso}T09:00:00`);

/** `2026-08` for the month picker, from any date. */
export const monthOf = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

export type DeliveryOrUntracked = DeliveryState | "Untracked";
