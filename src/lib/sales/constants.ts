/**
 * The vocabulary of the affiliate operation, kept pure so the models, the API
 * routes and the browser all name the same things.
 *
 * Nothing here imports mongoose or react — the schemas import these arrays for
 * their enums, and the screens import them to render a filter.
 */

/**
 * Where an order came from. Only Shopify today, but an order that was typed in
 * by hand after a phone sale is a real thing, and a source field is what stops
 * the sync deleting it as an orphan.
 */
export const ORDER_SOURCES = ["Shopify", "Manual", "Import"] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];

/**
 * What actually happened to the parcel, reduced from Shiprocket's forty-odd
 * status strings to the six outcomes that decide whether anybody is paid.
 *
 * `Awaiting` is the honest starting point: the order exists in Shopify and
 * Shiprocket has not been asked about it yet, or has nothing to say. It is
 * deliberately different from `Undelivered`, which is a courier reporting a
 * failed attempt — one is ignorance, the other is news.
 */
export const DELIVERY_STATES = [
  "Awaiting",
  "In transit",
  "Delivered",
  "Undelivered",
  "RTO",
  "Returned",
  "Cancelled",
  "Lost"
] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];

/** The one outcome that earns anybody anything. */
export const EARNING_STATE: DeliveryState = "Delivered";

/**
 * States from which a parcel will never earn a commission. Kept as data rather
 * than an `if`, because the list is the policy: a returned parcel and a parcel
 * lost by the courier both mean the company holds no money for it.
 */
export const VOID_STATES: readonly DeliveryState[] = ["RTO", "Returned", "Cancelled", "Lost"];

/**
 * The life of one order's commission.
 *
 * `Pending`   — the parcel is still out. Nothing is owed yet.
 * `Maturing`  — delivered, inside the return window. Owed, but not yet payable.
 * `Payable`   — the window has passed and no payout run has claimed it.
 * `In payout` — sitting on a draft or approved run. The figure is frozen.
 * `Paid`      — the run that carried it has been paid.
 * `Void`      — RTO, returned, cancelled, lost or refunded. Never payable.
 */
export const COMMISSION_STATUSES = ["Pending", "Maturing", "Payable", "In payout", "Paid", "Void"] as const;
export type CommissionStatus = (typeof COMMISSION_STATUSES)[number];

/** Once a run has claimed a commission, its figure is the run's to honour. */
export const COMMITTED_STATUSES: readonly CommissionStatus[] = ["In payout", "Paid"];

/**
 * A payout run's life, borrowed wholesale from payroll next door and for the
 * same reason: preparing a payment and releasing it are different authorities,
 * and a run that has been paid can never be reopened because the money has gone.
 */
export const PAYOUT_STATUSES = ["Draft", "Approved", "Paid"] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

/** How a payout actually leaves the company. */
export const PAYOUT_MODES = ["Bank transfer", "UPI", "Cash", "Cheque", "Other"] as const;
export type PayoutMode = (typeof PAYOUT_MODES)[number];

/**
 * Which money a commission rate is applied to.
 *
 * `Discounted lines` is the default and the one that needs no maintenance:
 * Shopify records, per line, how much each discount code took off it, so the
 * lines a coupon actually applied to are the lines it discounted. A rep whose
 * code only works on one product is paid on that product without anybody
 * keeping a list of which product it was.
 */
export const COMMISSION_BASES = ["Discounted lines", "Whole order", "Named products"] as const;
export type CommissionBase = (typeof COMMISSION_BASES)[number];

/** The default hold before a delivered order's commission may be paid, in days. */
export const DEFAULT_HOLD_DAYS = 7;

/** How far back a first sync reaches when nothing has ever been pulled. */
export const DEFAULT_BACKFILL_DAYS = 90;
