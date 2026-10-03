import { VOID_STATES, type DeliveryState } from "@/lib/sales/constants";

/**
 * The sales team's orders, and what each one earns the executive who placed it.
 *
 * Pure, like the rest of the arithmetic in this application (§4.1): the order
 * form shows a total and an incentive as the executive types, and the server
 * recomputes both from the raw lines before anything is stored. Both call these
 * functions, so the figure on screen and the figure saved cannot disagree.
 *
 * This is a different business from the affiliate one next door and is kept
 * apart from it on purpose. An affiliate is an outsider paid a commission on
 * whatever their coupon brought in through the shop; a sales executive is an
 * employee who takes the order themselves — on the phone, from a lead they were
 * handed — and is paid an incentive on it. The parcel goes out through the same
 * Shiprocket account and the same booking code, and that is all the two share.
 */

// ---------------------------------------------------------------- vocabulary

/**
 * How the customer pays, which decides three things at once: what the courier
 * collects at the door, what Shiprocket is told the order is, and what the
 * incentive rate is.
 *
 * `Partial` is the one worth spelling out. The customer pays something now — a
 * token amount by UPI, usually, to show they mean it — and the rest in cash on
 * delivery. It is booked with the courier as COD for the balance, and it is
 * priced as its own rule because it sits between the other two in how likely it
 * is to come back: a customer who has paid ₹200 refuses the parcel far less
 * often than one who has paid nothing.
 */
export const TEAM_PAYMENT_MODES = ["COD", "Prepaid", "Partial"] as const;
export type TeamPaymentMode = (typeof TEAM_PAYMENT_MODES)[number];

export const PAYMENT_MODE_LABEL: Record<TeamPaymentMode, string> = {
  COD: "Cash on delivery",
  Prepaid: "Prepaid",
  Partial: "Partial payment"
};

/** Where an executive's order is placed — see `SalesTeamSettings.orderChannel`. */
export const TEAM_ORDER_CHANNELS = ["Shopify", "Direct"] as const;
export type TeamOrderChannel = (typeof TEAM_ORDER_CHANNELS)[number];

/** A percentage of the order, or a fixed sum per delivered order. */
export const INCENTIVE_TYPES = ["Percentage", "Flat"] as const;
export type IncentiveType = (typeof INCENTIVE_TYPES)[number];

/**
 * The life of one order's incentive.
 *
 * `Pending`      — the parcel is still out. Nothing is owed yet.
 * `Payable`      — delivered. Owed, waiting to be paid.
 * `Paid`         — an administrator has paid it and marked it so.
 * `Void`         — cancelled, RTO, returned or lost. Never payable.
 * `Not eligible` — the administrator has switched incentives off for this
 *                  payment mode. Recorded rather than shown as ₹0 Pending, so
 *                  nobody waits on money that was never coming.
 */
export const INCENTIVE_STATUSES = ["Pending", "Payable", "Paid", "Void", "Not eligible"] as const;
export type IncentiveStatus = (typeof INCENTIVE_STATUSES)[number];

/** How an incentive actually leaves the company. */
export const INCENTIVE_PAY_MODES = ["Bank transfer", "UPI", "Cash", "With salary", "Other"] as const;
export type IncentivePayMode = (typeof INCENTIVE_PAY_MODES)[number];

/** One rule per payment mode — whether it earns, and how much. */
export type IncentiveRule = {
  mode: TeamPaymentMode;
  enabled: boolean;
  type: IncentiveType;
  value: number;
};

/**
 * Where a new installation starts. Prepaid pays best because it never comes
 * back unpaid; COD least because it is the one that does. An administrator
 * changes these on the Incentive rules screen — they are a starting point, not a
 * policy anybody chose.
 */
export const DEFAULT_INCENTIVE_RULES: IncentiveRule[] = [
  // The Sales Team Handbook, Section 8: 10% prepaid, 10% partial, 5% COD, on the net order value.
  { mode: "Prepaid", enabled: true, type: "Percentage", value: 10 },
  { mode: "Partial", enabled: true, type: "Percentage", value: 10 },
  { mode: "COD", enabled: true, type: "Percentage", value: 5 }
];

/** The rule for a mode, filling in from the defaults for anything not stored. */
export function ruleFor(rules: readonly IncentiveRule[] | null | undefined, mode: TeamPaymentMode): IncentiveRule {
  return rules?.find(rule => rule.mode === mode)
    ?? DEFAULT_INCENTIVE_RULES.find(rule => rule.mode === mode)
    ?? { mode, enabled: false, type: "Percentage", value: 0 };
}

/** The whole table, in the order the screen shows it, defaults filling the gaps. */
export const rulesTable = (rules: readonly IncentiveRule[] | null | undefined): IncentiveRule[] =>
  TEAM_PAYMENT_MODES.map(mode => ruleFor(rules, mode));

/** `Percentage 5` reads as "5% of the order"; `Flat 100` as "₹100 an order". */
export function describeRule(rule: Pick<IncentiveRule, "enabled" | "type" | "value">): string {
  if (!rule.enabled) return "No incentive";
  return rule.type === "Percentage" ? `${rule.value}% of the order` : `₹${rule.value} per order`;
}

// ------------------------------------------------------------------ the order

/** Paise survive arithmetic; rounding is to the paisa and never in between. */
export const money = (value: number) => Math.round((Number(value) || 0) * 100) / 100;

/** Incentives are whole rupees, as commissions are: ₹449.70 invites an argument ₹450 does not. */
export const rupees = (value: number) => Math.round(Number(value) || 0);

export type LineInput = { title: string; sku?: string; variantId?: string; quantity: number; price: number };

/**
 * One line as it is stored, in the shape the booking code already reads.
 *
 * `gross` is the whole line, not the unit — the same convention the affiliate
 * orders use (§6.15) — and `otherDiscount` is this line's share of the order's
 * discount. That is what lets `lib/sales/booking.ts` book a team order with no
 * changes: it already knows how to turn exactly these fields into a Shiprocket
 * order whose line prices add up to what the customer owes.
 */
export type PricedLine = LineInput & { gross: number; couponDiscount: number; otherDiscount: number };

export type PricedOrder = { lines: PricedLine[]; gross: number; discount: number; total: number };

/**
 * The order's lines and totals from what the executive typed.
 *
 * A discount is taken off the order and then spread across the lines in
 * proportion to their value, the last line taking whatever rounding left over —
 * so the lines always add up to the total exactly, which is what a courier
 * collecting cash checks first.
 */
export function priceOrder(lines: readonly LineInput[], discount = 0): PricedOrder {
  const priced = lines
    .filter(line => String(line.title ?? "").trim() && Number(line.quantity) > 0)
    .map(line => {
      const quantity = Math.max(1, Math.round(Number(line.quantity)));
      const price = Math.max(0, money(line.price));
      return {
        title: String(line.title).trim(),
        sku: line.sku?.trim() || undefined,
        variantId: line.variantId || undefined,
        quantity,
        price,
        gross: money(quantity * price),
        couponDiscount: 0,
        otherDiscount: 0
      };
    });

  const gross = money(priced.reduce((sum, line) => sum + line.gross, 0));
  const off = Math.min(gross, Math.max(0, money(discount)));

  let left = off;
  priced.forEach((line, index) => {
    const share = index === priced.length - 1 ? left : money(gross ? (off * line.gross) / gross : 0);
    line.otherDiscount = Math.min(line.gross, share);
    left = money(left - line.otherDiscount);
  });

  return { lines: priced, gross, discount: off, total: money(gross - off) };
}

/**
 * What the courier collects at the door. Nothing on a prepaid order, the whole
 * order on COD, and the balance after the advance on a part payment.
 */
export function collectAmountOf(mode: TeamPaymentMode, total: number, advance = 0): number {
  if (mode === "Prepaid") return 0;
  if (mode === "COD") return money(total);
  return money(Math.max(0, total - Math.max(0, advance)));
}

/**
 * Why this payment does not add up, or null when it does.
 *
 * A part payment has to be a real part: an advance of nothing is a COD order
 * filed under the wrong rule, and an advance of the whole order is a prepaid one
 * — either would be priced at a rate meant for something else.
 */
export function paymentProblem(mode: TeamPaymentMode, total: number, advance = 0): string | null {
  if (total <= 0) return "The order has no value. Add at least one product with a price.";
  if (mode !== "Partial") return null;
  if (!(advance > 0)) return "Enter the amount the customer has already paid.";
  if (advance >= total) return "The advance covers the whole order — choose Prepaid instead.";
  return null;
}

/** `BHX-SE-00042`. Also the name the order is booked under at Shiprocket. */
export const teamOrderNo = (sequence: number) => `BHX-SE-${String(sequence).padStart(5, "0")}`;

// ------------------------------------------------------------- the incentive

/** What a rule pays on an order of this value. */
export function incentiveAmountOf(rule: Pick<IncentiveRule, "enabled" | "type" | "value">, base: number): number {
  if (!rule.enabled || base <= 0) return 0;
  return rule.type === "Flat" ? rupees(rule.value) : rupees((base * rule.value) / 100);
}

export type IncentiveInput = {
  rule: Pick<IncentiveRule, "enabled" | "type" | "value">;
  base: number;
  delivery: DeliveryState;
  cancelled: boolean;
  /** Already paid. A paid incentive is a matter of record and is never restated. */
  paid: boolean;
};

export type IncentiveResult = {
  status: IncentiveStatus;
  amount: number;
  reason?: string;
  /** Paid, then the parcel came back — for somebody to act on, never reversed by itself. */
  needsReversal: boolean;
};

/**
 * Where one order's incentive stands.
 *
 * The same shape of rule the affiliate commission follows (§4.13a, §4.13b):
 * delivered is owed, a parcel that came back earns nothing, and money already
 * paid is never recomputed underneath its own record. If a paid order is later
 * returned, it is flagged rather than reversed — that is recovered by
 * agreement, from a person, not by a background job editing what was paid.
 */
export function priceIncentive(input: IncentiveInput): IncentiveResult {
  const amount = incentiveAmountOf(input.rule, input.base);
  const lost = input.cancelled || VOID_STATES.includes(input.delivery);

  if (input.paid) {
    return {
      status: "Paid",
      amount,
      needsReversal: lost,
      reason: lost ? "Paid, but the order was later cancelled or came back." : undefined
    };
  }
  if (!input.rule.enabled) {
    return { status: "Not eligible", amount: 0, needsReversal: false, reason: "Incentives are switched off for this payment mode." };
  }
  if (input.cancelled) return { status: "Void", amount: 0, needsReversal: false, reason: "The order was cancelled." };
  if (lost) return { status: "Void", amount: 0, needsReversal: false, reason: `The parcel was ${input.delivery === "RTO" ? "returned to origin" : input.delivery.toLowerCase()}.` };
  if (input.delivery === "Delivered") return { status: "Payable", amount, needsReversal: false };
  return { status: "Pending", amount, needsReversal: false, reason: "Earned once the parcel is delivered." };
}

/** Badge colours, so an incentive status reads the same on every screen. */
export function incentiveTone(status: string): "success" | "info" | "warn" | "danger" | "neutral" {
  switch (status) {
    case "Paid": return "success";
    case "Payable": return "info";
    case "Pending": return "warn";
    case "Void": return "danger";
    default: return "neutral";
  }
}

/** `₹1,499` — whole rupees for incentives and summaries, paise where an order has them. */
export function formatRupees(value: number): string {
  const amount = Number(value) || 0;
  const whole = Number.isInteger(money(amount));
  return `₹${amount.toLocaleString("en-IN", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}
