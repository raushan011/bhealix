import { DEFAULT_PARCEL, type CourierRule, type ProcessState } from "./constants";

/**
 * Booking a parcel: everything that can be decided without talking to anybody.
 *
 * The job this exists for is the one somebody currently does by hand. An order
 * arrives, they open Shiprocket in another tab, find it or type it in again,
 * check which couriers reach that pin code, pick one, assign an airway bill and
 * print the invoice. Forty times a morning, in a system that has never heard of
 * the coupon that brought the order in.
 *
 * Everything here is pure and tested, because the parts that are not — the four
 * calls to Shiprocket in `shiprocket.ts`, the write in the route — are the parts
 * that cannot be checked against a literal. What *can* be is the arithmetic and
 * the refusals: what a parcel is worth, which courier a rule picks, and the
 * three or four fields whose absence Shiprocket answers with `billing_phone: The
 * billing phone must be 10 digits` fifty times in a row.
 *
 * The refusals are the point. Pushing a batch at somebody else's API and finding
 * out one order at a time is slow, rude and hard to read afterwards; an order
 * that cannot be booked should say so before anything is sent.
 */

// ------------------------------------------------------------------ the shapes

/** A parcel's own measurements. Centimetres and kilograms, which is what Shiprocket reads. */
export type Parcel = { weight: number; length: number; breadth: number; height: number };

/**
 * Where the parcel is going, as Shiprocket needs it.
 *
 * A superset of what an order carries: the Shopify sync fills in what the
 * checkout collected, the operator fills in the rest. Orders imported from the
 * Fastrr checkout export (§ import) routinely have a city and a phone and no
 * street at all, and no amount of care here can invent one.
 */
export type Address = {
  name?: string;
  phone?: string;
  email?: string;
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  pinCode?: string;
  country?: string;
};

/** The part of an order this module reads. Narrow on purpose — it is also the test fixture. */
export type BookableOrder = {
  name?: string;
  placedAt?: string | Date;
  customer?: Address | null;
  items?: { sku?: string; title: string; quantity: number; gross: number; couponDiscount?: number; otherDiscount?: number }[];
  totals?: { paid?: number; gross?: number };
  paymentMethod?: string | null;
  financialStatus?: string | null;
  cancelledAt?: string | Date | null;
  fullyRefunded?: boolean;
  shipment?: {
    shiprocketOrderId?: string;
    shipmentId?: string;
    awb?: string;
    courier?: string;
    pickupScheduledAt?: string | Date | null;
  } | null;
};

/** One courier Shiprocket says can reach the pin code, reduced to what a person chooses on. */
export type CourierOption = {
  id: number;
  name: string;
  /** All in, in rupees — freight plus the COD fee where one applies. */
  rate: number;
  /** Working days, as the courier estimates them. Absent when Shiprocket does not say. */
  days?: number;
  /** Shiprocket's own delivery estimate, verbatim, for the row to show. */
  etd?: string;
  rating?: number;
  /** Surface is the slow, cheap one; air is the other. Worth showing beside the price. */
  surface?: boolean;
  cod?: boolean;
  /** Shiprocket's own suggestion out of the list. */
  recommended?: boolean;
};

/** One of the company's own addresses, as the parcel's origin. */
export type PickupLocation = {
  /** The nickname Shiprocket files it under, which is what the booking call sends. */
  name: string;
  address?: string;
  city?: string;
  state?: string;
  pinCode?: string;
  phone?: string;
};

// -------------------------------------------------------------- what is where

const text = (value: unknown) => String(value ?? "").trim();

/**
 * COD or Prepaid, which is the one field on a booking that cannot be guessed
 * wrong without consequences.
 *
 * A prepaid order booked as COD asks the customer for money they have already
 * paid at the door, and a COD order booked as prepaid hands the parcel over for
 * nothing. The Shopify sync already reduces every gateway to the word "COD"
 * (§ shopify), so this reads that first and only falls back to sniffing the
 * gateway name for an order that came in through an import.
 */
export function paymentModeOf(order: BookableOrder): "COD" | "Prepaid" {
  const method = text(order.paymentMethod).toUpperCase();
  if (!method) return order.financialStatus === "paid" ? "Prepaid" : "COD";
  return /\bCOD\b|CASH ON DELIVERY/.test(method) ? "COD" : "Prepaid";
}

/**
 * What the courier collects at the door, and what the parcel is declared at.
 *
 * `totals.paid` is what the customer actually owes after the coupon came off,
 * which is the figure a COD parcel must be booked for. Booking it at the gross
 * would have the courier collect the discount back off the customer.
 */
export const parcelValueOf = (order: BookableOrder): number =>
  Math.max(0, Math.round(Number(order.totals?.paid ?? 0)));

/** The address as it stands, with anything the operator typed taking precedence. */
export function addressOf(order: BookableOrder, overrides?: Address | null): Address {
  const merged: Address = { ...(order.customer ?? {}), ...stripBlank(overrides) };
  return { ...merged, country: text(merged.country) || "India" };
}

/** An override that was left empty must not blank out what the order already knew. */
export function stripBlank(input?: Address | null): Address {
  if (!input) return {};
  const kept: Address = {};
  for (const [key, value] of Object.entries(input)) {
    if (text(value)) kept[key as keyof Address] = text(value);
  }
  return kept;
}

/**
 * The digits of an Indian mobile number, or nothing.
 *
 * Shiprocket wants ten digits and refuses anything else, and checkouts store the
 * same number six ways — `+91 98765 43210`, `09876543210`, `91-9876543210`.
 * Rewriting them here is the difference between a batch that books and a batch
 * that comes back forty identical validation errors.
 */
export function tenDigitPhone(value: string | undefined | null): string {
  const digits = text(value).replace(/\D/g, "");
  const local = digits.length > 10 ? digits.slice(-10) : digits;
  return /^[6-9]\d{9}$/.test(local) ? local : "";
}

const PIN = /^\d{6}$/;

/**
 * What is missing before this order can be sent, in the words the screen shows.
 *
 * Every one of these is a field Shiprocket rejects the booking over. Listing
 * them together lets the operator fix an address once, in a form, rather than
 * discovering them one refusal at a time.
 */
export function missingFields(address: Address): string[] {
  const missing: string[] = [];
  if (!text(address.name)) missing.push("customer name");
  if (!text(address.address1)) missing.push("street address");
  if (!text(address.city)) missing.push("city");
  if (!text(address.state)) missing.push("state");
  if (!PIN.test(text(address.pinCode))) missing.push("6-digit pin code");
  if (!tenDigitPhone(address.phone)) missing.push("10-digit phone number");
  return missing;
}

/**
 * Why this order must not be booked at all, or null when it may be.
 *
 * Separate from `missingFields` because these cannot be fixed by typing: a
 * cancelled order has nothing to ship, and one that already carries an airway
 * bill has been booked once. Sending it again is how a customer receives two
 * parcels and the company pays two freights.
 */
export function blockedReason(order: BookableOrder): string | null {
  if (order.cancelledAt) return "This order was cancelled.";
  if (order.fullyRefunded) return "This order was fully refunded.";
  if (text(order.shipment?.awb)) return `Already booked on ${order.shipment?.courier || "a courier"} (AWB ${order.shipment?.awb}).`;
  if (!order.items?.length) return "This order has no items on it to ship.";
  return null;
}

/** How far along the courier side of an order is. See `PROCESS_STATES`. */
export function processStateOf(order: BookableOrder): ProcessState {
  const shipment = order.shipment ?? undefined;
  if (shipment?.pickupScheduledAt) return "Pickup scheduled";
  if (text(shipment?.awb)) return "Ready to ship";
  if (text(shipment?.shiprocketOrderId)) return "Booked";
  return "Not processed";
}

/** Badge colours, so a processing state reads the same on every screen. */
export function processTone(state: ProcessState): "success" | "info" | "warn" | "neutral" {
  switch (state) {
    case "Pickup scheduled": return "success";
    case "Ready to ship": return "info";
    case "Booked": return "warn";
    default: return "neutral";
  }
}

// ------------------------------------------------------------------- the parcel

/** A parcel's measurements, with anything absent or nonsensical falling back to the default carton. */
export function normaliseParcel(input?: Partial<Parcel> | null): Parcel {
  const positive = (value: unknown, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : fallback;
  };
  return {
    weight: positive(input?.weight, DEFAULT_PARCEL.weight),
    length: positive(input?.length, DEFAULT_PARCEL.length),
    breadth: positive(input?.breadth, DEFAULT_PARCEL.breadth),
    height: positive(input?.height, DEFAULT_PARCEL.height)
  };
}

// ------------------------------------------------------------ the booking body

/** Shiprocket's own field names, which is the only reason this shape is shouted at in snake case. */
export type AdhocOrderPayload = {
  order_id: string;
  order_date: string;
  pickup_location: string;
  billing_customer_name: string;
  billing_last_name: string;
  billing_address: string;
  billing_address_2?: string;
  billing_city: string;
  billing_pincode: string;
  billing_state: string;
  billing_country: string;
  billing_email?: string;
  billing_phone: string;
  shipping_is_billing: true;
  order_items: { name: string; sku: string; units: number; selling_price: number }[];
  payment_method: "COD" | "Prepaid";
  sub_total: number;
  length: number;
  breadth: number;
  height: number;
  weight: number;
};

/**
 * `2026-08-15 14:30`, which is the only format Shiprocket's order date accepts.
 *
 * Written in local time deliberately, matching the way the same service's
 * timestamps are *read* (§ shiprocket): the account, the courier and the
 * warehouse are all Indian, and converting to UTC here would file a
 * ten-past-midnight order under the previous day.
 */
export function shiprocketDate(value: string | Date | undefined): string {
  const date = value ? new Date(value) : new Date();
  const at = Number.isNaN(date.getTime()) ? new Date() : date;
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/**
 * One order as Shiprocket wants it typed in.
 *
 * `order_id` is the shop's own name for the order — `#1042` — and not this
 * database's id, because that is the key the delivery sync joins back on
 * (`channel_order_id`, § shiprocket). Booking under anything else would create a
 * parcel this CRM could never find again, and a rep whose order was delivered
 * would never be paid for it.
 *
 * The line prices are what the customer actually paid per unit after the coupon,
 * so the sub-total matches what a COD courier is asked to collect. A line that
 * was free after a discount is still sent, at zero: Shiprocket refuses an order
 * with no items far more readably than it refuses one whose sub-total disagrees
 * with its lines.
 */
export function buildAdhocOrder(
  { order, address, parcel, pickupLocation }:
  { order: BookableOrder; address: Address; parcel: Parcel; pickupLocation: string }
): AdhocOrderPayload {
  const [first, ...rest] = text(address.name).split(/\s+/);
  const items = (order.items ?? []).map((item, index) => {
    const units = Math.max(1, Math.round(Number(item.quantity) || 1));
    const net = Math.max(0, Number(item.gross ?? 0) - Number(item.couponDiscount ?? 0) - Number(item.otherDiscount ?? 0));
    return {
      name: text(item.title) || "Item",
      sku: text(item.sku) || `LINE-${index + 1}`,
      units,
      selling_price: Math.round((net / units) * 100) / 100
    };
  });

  return {
    order_id: text(order.name),
    order_date: shiprocketDate(order.placedAt),
    pickup_location: text(pickupLocation),
    billing_customer_name: first || "Customer",
    billing_last_name: rest.join(" "),
    billing_address: text(address.address1),
    billing_address_2: text(address.address2) || undefined,
    billing_city: text(address.city),
    billing_pincode: text(address.pinCode),
    billing_state: text(address.state),
    billing_country: text(address.country) || "India",
    billing_email: text(address.email) || undefined,
    billing_phone: tenDigitPhone(address.phone),
    shipping_is_billing: true,
    order_items: items,
    payment_method: paymentModeOf(order),
    sub_total: parcelValueOf(order),
    ...parcel
  };
}

// ----------------------------------------------------------- choosing a courier

export type CourierChoice = { id?: number; rule?: CourierRule };

/**
 * Which courier out of the ones that can actually reach the address.
 *
 * A named id wins outright and is *not* substituted when it is missing from the
 * list — a batch told to go by Delhivery and quietly sent by three other
 * couriers is worse than a batch that says which four orders Delhivery cannot
 * serve. Everything else is decided per order, which is what makes one press
 * work for forty parcels bound for forty pin codes.
 */
export function pickCourier(couriers: CourierOption[], choice: CourierChoice): { courier?: CourierOption; error?: string } {
  if (!couriers.length) return { error: "No courier serves this pin code at this weight." };

  if (choice.id) {
    const named = couriers.find(courier => courier.id === choice.id);
    return named ? { courier: named } : { error: "The chosen courier does not serve this pin code at this weight." };
  }

  const byRate = [...couriers].sort((left, right) => left.rate - right.rate);
  switch (choice.rule ?? "recommended") {
    case "cheapest":
      return { courier: byRate[0] };
    case "fastest":
      // Days first, then price, so two couriers promising tomorrow are separated
      // by cost rather than by whatever order Shiprocket happened to answer in.
      return { courier: [...couriers].sort((left, right) =>
        (left.days ?? 99) - (right.days ?? 99) || left.rate - right.rate)[0] };
    default:
      // Shiprocket's own pick, which weighs the courier's delivery record as
      // well as its price. Falls back to the cheapest when it names nobody.
      return { courier: couriers.find(courier => courier.recommended) ?? byRate[0] };
  }
}

// --------------------------------------------------------------- presentation

/** `1 order` / `12 orders`, because "1 orders" in a progress line reads as a bug. */
export const orderCount = (count: number) => `${count} order${count === 1 ? "" : "s"}`;

/**
 * What the downloaded file is called.
 *
 * Named after the order when there is one, so a folder of thirty invoices can be
 * matched to thirty orders without opening any of them.
 */
export function documentFileName(kind: "invoice" | "label", names: string[]): string {
  const stem = names.length === 1 ? text(names[0]).replace(/[^\w.-]+/g, "") || "order" : `${names.length}-orders`;
  return `${kind}-${stem}.pdf`;
}
