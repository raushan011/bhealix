import { deliveryStateFrom } from "@/lib/sales/delivery";
import type { ShiprocketListedOrder } from "@/lib/sales/shiprocket";
import type { MappedOrder, ShopifyOrder } from "@/lib/sales/shopify";
import { collectAmountOf, money, type TeamPaymentMode } from "./orders";
import { TEAM_TAG } from "./shopify-order";

/**
 * Every order the business takes, in the Sales CRM — not only the ones an
 * executive placed here.
 *
 * Shop orders (Shopify) and orders that exist only on the courier account
 * (Shiprocket's custom channel) are brought in from `IMPORT_FROM` onwards, then
 * kept coming: the nightly pass, Shopify's order webhook, and the desk's orders
 * screen each bring in what is new. Once in, an order is tracked like any other
 * — the same Shiprocket sync, the same webhook, the same "delivering today".
 *
 * Three rules, because two of them touch somebody's pay:
 *
 * 1. **An imported order earns no incentive.** It was not placed as an
 *    executive's sale, so the incentive is switched off on it; moving it to an
 *    executive shows it to them without paying them for it.
 * 2. **A copy of a CRM order is not imported again.** The office re-makes an
 *    executive's order in the shop to correct it (#1806 for #1802); that copy is
 *    linked to the original as its parcel instead, or the sale would count twice.
 * 3. **An order the sales team tagged in the shop** (`exec-<employee ID>`) goes
 *    to that executive, so they see it; everything else waits, unassigned, for
 *    the desk to hand out with "Move orders".
 *
 * Everything here is pure; the reading and writing is in `shop-import-run.ts`.
 */

/** The first day brought in: 1 September 2026, India time. */
export const IMPORT_FROM = new Date("2026-09-01T00:00:00+05:30");
/** How long before a copy is made that its original may have been placed. */
const COPY_WINDOW_MS = 15 * 86_400_000;

const digits = (value: unknown) => String(value ?? "").replace(/\D/g, "");
const phoneOf = (value: unknown) => {
  const all = digits(value);
  return all.length >= 10 ? all.slice(-10) : "";
};

export const tagsOf = (order: Pick<ShopifyOrder, "tags">): string[] =>
  String(order.tags ?? "").split(",").map(tag => tag.trim()).filter(Boolean);

/** The CRM's `BHX-SE-…` number written on an order this CRM placed in the shop. */
export const crmRefOf = (order: Pick<ShopifyOrder, "note_attributes">): string | undefined =>
  (order.note_attributes ?? []).find(entry => String(entry.name ?? "").trim().toLowerCase() === "crm order")?.value?.trim() || undefined;

/** The executive an order was tagged for in the shop, by their `exec-<employee ID>` tag. */
export function executiveFromTags<T>(order: Pick<ShopifyOrder, "tags">, byTag: Map<string, T>): T | undefined {
  for (const tag of tagsOf(order)) {
    const found = byTag.get(tag.toLowerCase());
    if (found) return found;
  }
  return undefined;
}

export type CrmOrderRef = {
  _id: unknown; ref?: string | null; shopifyOrderId?: string | null; placedAt: Date;
  totals?: { paid?: number | null } | null; customer?: { phone?: string | null } | null;
};

/**
 * The CRM order a shop order is a copy of, or null. A copy says so in its note
 * ("CRM order: BHX-SE-00001") when Shopify duplicated the attributes; when it
 * did not, a sales-team-tagged order to the same phone for the same amount,
 * shortly after a CRM order, is taken to be one.
 */
export function copyOfCrmOrder<T extends CrmOrderRef>(raw: ShopifyOrder, mapped: Pick<MappedOrder, "placedAt" | "customer" | "totals">, crm: T[]): T | null {
  const ownId = String(raw.id);
  const others = crm.filter(order => String(order.shopifyOrderId ?? "") !== ownId);

  const ref = crmRefOf(raw);
  if (ref) {
    const named = others.find(order => order.ref === ref);
    if (named) return named;
  }
  if (!tagsOf(raw).some(tag => tag.toLowerCase() === TEAM_TAG.toLowerCase())) return null;

  const phone = phoneOf(mapped.customer.phone);
  const total = Math.round(mapped.totals.paid);
  const created = mapped.placedAt.getTime();
  return others.find(order => {
    const placed = new Date(order.placedAt).getTime();
    return Boolean(phone) && phoneOf(order.customer?.phone) === phone
      && Math.round(Number(order.totals?.paid ?? NaN)) === total
      && placed <= created && created - placed <= COPY_WINDOW_MS;
  }) ?? null;
}

/** How the customer pays, as the shop recorded it. */
export function paymentOfShopOrder(raw: Pick<ShopifyOrder, "financial_status">, mapped: Pick<MappedOrder, "totals" | "paymentMethod">) {
  const total = mapped.totals.paid;
  const status = String(raw.financial_status ?? "").toLowerCase();
  const mode: TeamPaymentMode = status === "paid" || status === "refunded" || status === "partially_refunded"
    ? "Prepaid"
    : status === "partially_paid" ? "Partial" : /cod|cash/i.test(mapped.paymentMethod ?? "") || status === "pending" ? "COD" : "Prepaid";
  // A part payment's advance is not on the order list; what is owed at the door is taken as the whole until the courier says otherwise.
  const advance = mode === "Prepaid" ? total : 0;
  return { paymentMode: mode, advancePaid: advance, collectAmount: mode === "Partial" ? total : collectAmountOf(mode, total, advance) };
}

const NO_INCENTIVE = { enabled: false, type: "Percentage", value: 0, amount: 0, status: "Not eligible", reason: "Imported from the shop — not placed as an executive's sale." };

/** A shop order as a Sales CRM order. */
export function teamOrderFromShopify(raw: ShopifyOrder, mapped: MappedOrder, executive?: { _id: unknown; name: string }) {
  const payment = paymentOfShopOrder(raw, mapped);
  return {
    name: mapped.name,
    channel: "Shopify",
    origin: "Shopify",
    shopifyOrderId: mapped.shopifyOrderId,
    orderNumber: mapped.orderNumber,
    placedAt: mapped.placedAt,
    ...(executive ? { executive: executive._id, executiveName: executive.name } : {}),
    customer: { ...mapped.customer, country: mapped.customer.country || "India" },
    items: mapped.items.filter(line => line.quantity > 0).map(line => ({
      variantId: line.variantId, sku: line.sku, title: line.title, quantity: line.quantity,
      price: money(line.gross / line.quantity), mrp: money(line.gross / line.quantity),
      gross: line.gross, couponDiscount: line.couponDiscount, otherDiscount: line.otherDiscount
    })),
    totals: { gross: mapped.totals.gross, discount: mapped.totals.discount, paid: mapped.totals.paid },
    ...payment,
    paymentMethod: payment.paymentMode === "Prepaid" ? "Prepaid" : "COD",
    financialStatus: mapped.financialStatus,
    ...(mapped.cancelledAt || mapped.fullyRefunded
      ? { cancelledAt: mapped.cancelledAt ?? new Date(), cancelReason: mapped.cancelledAt ? "Cancelled in Shopify." : "Refunded in full in Shopify." }
      : {}),
    incentive: NO_INCENTIVE
  };
}

/** Shiprocket's `04 Oct 2026, 07:26 PM` or `2026-10-04 19:26:00`, as a date. */
export function shiprocketDate(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(/^\d{4}-\d{2}-\d{2} /.test(value) ? value.replace(" ", "T") : value.replace(",", ""));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** An order that exists only on the courier account, as a Sales CRM order — all Shiprocket's list says about it. */
export function teamOrderFromShiprocket(row: ShiprocketListedOrder) {
  const total = money(Number(row.total ?? 0));
  const cod = /cod|cash/i.test(row.paymentMethod ?? "");
  const reported = deliveryStateFrom(row.status);
  return {
    name: row.channelOrderId || `SR-${row.shiprocketOrderId}`,
    channel: "Direct",
    origin: "Shiprocket",
    placedAt: shiprocketDate(row.createdAt) ?? new Date(),
    customer: { name: row.customerName, phone: row.customerPhone, city: row.city, pinCode: row.pinCode, country: "India" },
    items: [],
    totals: { gross: total, discount: 0, paid: total },
    paymentMode: cod ? "COD" : "Prepaid",
    paymentMethod: cod ? "COD" : "Prepaid",
    advancePaid: cod ? 0 : total,
    collectAmount: cod ? total : 0,
    shipment: {
      shiprocketOrderId: row.shiprocketOrderId, channelOrderId: row.channelOrderId || undefined,
      awb: row.awb, courier: row.courier, status: row.status, checkedAt: new Date()
    },
    delivery: { reported, state: reported, at: new Date() },
    ...(reported === "Cancelled" ? { cancelledAt: new Date(), cancelReason: "Cancelled in Shiprocket." } : {}),
    incentive: NO_INCENTIVE
  };
}

/** Every name a Shiprocket row could be filed under, to tell whether it is already here. */
export const shiprocketKeysOf = (row: Pick<ShiprocketListedOrder, "channelOrderId">) => {
  const id = String(row.channelOrderId ?? "").trim().toUpperCase();
  return id ? [id, id.replace(/^#/, ""), `#${id.replace(/^#/, "")}`] : [];
};
