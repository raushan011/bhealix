import {
  COMMITTED_STATUSES,
  DEFAULT_HOLD_DAYS,
  EARNING_STATE,
  VOID_STATES,
  type CommissionBase,
  type CommissionStatus,
  type CustomerDiscountType,
  type DeliveryState
} from "./constants";

/**
 * What a rep earns on an order, and when it becomes theirs to be paid.
 *
 * Pure and tested, because this is the arithmetic somebody is paid on. The sync
 * computes it server-side and the screens re-render the same numbers from the
 * same functions, so what a rep is shown and what the payout run pays can never
 * be two different figures.
 *
 * Everything is in **whole rupees**. A commission is a payment to a person, and
 * a payout advice reading ₹449.70 invites an argument that ₹450 does not.
 */
export const rupees = (value: number) => Math.round(value);

// ------------------------------------------------------------------- the rule

/**
 * One coupon suffix and what it pays. Held as data rather than code because the
 * rates are a commercial decision — a 30 becoming a 35 is a Tuesday, not a
 * deployment.
 */
export type CommissionRule = {
  /** The digits at the end of the coupon: "10", "30". */
  suffix: string;
  /** What it is called on screen — "Pigmentation kit", "Single product". */
  label: string;
  /** Percent of the base. */
  rate: number;
  base: CommissionBase;
  /** SKUs or product titles, consulted only when the base is `Named products`. */
  products: string[];
  active: boolean;

  /**
   * What the customer gets off when they type a code paying under this rule.
   *
   * Nothing in this file reads it — a commission is worked out from what was
   * actually charged, not from what the discount was meant to be. It lives on
   * the rule because it is the other half of the same commercial decision, and
   * because it is what `lib/sales/provision.ts` needs to create the code in
   * Shopify when a rep mints one. Zero means "not decided yet", and a code
   * under such a rule is reserved rather than created.
   */
  customerDiscountType?: CustomerDiscountType;
  customerDiscountValue?: number;
  oncePerCustomer?: boolean;
};

/**
 * The two rules the operation runs on today, and what a fresh installation
 * starts with. Both are editable in settings; neither is referred to by name
 * anywhere in the code, so a third can be added without touching any of it.
 */
/**
 * The customer discount is left at zero on both, because nobody but this
 * company knows what its own coupons should take off. A rule at zero still pays
 * commission exactly as before — it simply cannot have codes created in Shopify
 * for it until somebody fills the figure in.
 */
export const DEFAULT_RULES: CommissionRule[] = [
  { suffix: "30", label: "Pigmentation kit", rate: 30, base: "Discounted lines", products: [], active: true, customerDiscountType: "Percentage", customerDiscountValue: 0, oncePerCustomer: true },
  { suffix: "10", label: "Single product", rate: 10, base: "Discounted lines", products: [], active: true, customerDiscountType: "Percentage", customerDiscountValue: 0, oncePerCustomer: true }
];

/**
 * One line of an order, reduced to the four figures a commission depends on.
 *
 * `couponDiscount` is what the *rep's own* code took off this line, which is
 * how a line knows whether the coupon applied to it. Shopify allocates a code's
 * discount across the lines it was valid for, so the lines carrying an
 * allocation are exactly the lines the coupon worked on.
 */
export type OrderLine = {
  sku?: string;
  title: string;
  quantity: number;
  /** Charged for this line before anything came off it. */
  gross: number;
  couponDiscount: number;
  /** A site-wide offer stacked on top of the rep's code. */
  otherDiscount: number;
  /** Money handed back on this line since. */
  refunded: number;
};

/** What the customer actually paid for a line, after every discount and refund. */
export const netOf = (line: OrderLine) =>
  Math.max(0, line.gross - line.couponDiscount - line.otherDiscount - line.refunded);

const normalise = (value: string | undefined) => (value ?? "").trim().toLowerCase();

/**
 * The lines a rule is paid on.
 *
 * `Discounted lines` needs a word. Shopify records a code's discount against
 * each line it applied to, so "the lines this coupon worked on" is a fact on the
 * order rather than a list somebody has to maintain. When no line carries an
 * allocation — an order-level discount, or an order pulled in before
 * allocations were recorded — the whole order is used instead and the caller is
 * told, because quietly paying on nothing and quietly paying on everything are
 * both worse than saying which happened.
 */
export function linesFor(lines: OrderLine[], rule: CommissionRule): { lines: OrderLine[]; wholeOrderFallback: boolean } {
  if (rule.base === "Named products") {
    const wanted = rule.products.map(normalise).filter(Boolean);
    return { lines: lines.filter(line => wanted.includes(normalise(line.sku)) || wanted.includes(normalise(line.title))), wholeOrderFallback: false };
  }

  if (rule.base === "Discounted lines") {
    const discounted = lines.filter(line => line.couponDiscount > 0);
    if (discounted.length) return { lines: discounted, wholeOrderFallback: false };

    // One line is not a fallback. "The lines the coupon discounted" and "the
    // whole order" are the same set, so there is nothing ambiguous to warn
    // about — and warning anyway would put a caution on every single-product
    // order, which is most of them, until nobody reads the warning at all.
    if (lines.length === 1) return { lines, wholeOrderFallback: false };

    return { lines, wholeOrderFallback: true };
  }

  return { lines, wholeOrderFallback: false };
}

export type CommissionBreakdown = {
  rate: number;
  /** The money the rate was applied to. */
  base: number;
  amount: number;
  /** No line carried an allocation from this coupon, so the whole order was used. */
  wholeOrderFallback: boolean;
  lines: { title: string; sku?: string; quantity: number; net: number }[];
};

/**
 * What the order is worth to the rep, before any question of whether it has
 * been delivered.
 *
 * Worked as a percentage of what the customer actually paid, which is the rule
 * the kit was specified with: MRP ₹2299, ₹800 off, so ₹1499 received and 30% of
 * that is ₹450. The same sentence covers the 10% code without a second rule.
 */
export function computeCommission(lines: OrderLine[], rule: CommissionRule): CommissionBreakdown {
  const scoped = linesFor(lines, rule);
  const base = scoped.lines.reduce((total, line) => total + netOf(line), 0);

  return {
    rate: rule.rate,
    base: rupees(base),
    amount: rupees((base * rule.rate) / 100),
    wholeOrderFallback: scoped.wholeOrderFallback,
    lines: scoped.lines.map(line => ({ title: line.title, sku: line.sku, quantity: line.quantity, net: rupees(netOf(line)) }))
  };
}

// ------------------------------------------------------------------ the clock

export const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000);

export type CommissionStateInput = {
  delivery: DeliveryState;
  /** When the courier delivered it. */
  deliveredAt?: Date | string | null;
  /** The order was cancelled in Shopify, whatever the courier says. */
  cancelled?: boolean;
  /** Every rupee has been refunded. */
  fullyRefunded?: boolean;
  /** What the order is worth, from `computeCommission`. */
  amount: number;
  holdDays?: number;
  now?: Date;
};

export type CommissionState = {
  status: CommissionStatus;
  /** The day it becomes payable. Absent unless it has been delivered. */
  maturesAt?: Date;
  /** Why it is not payable, in a sentence fit to put on screen. */
  reason?: string;
};

/**
 * Where an order's commission stands right now.
 *
 * The hold exists because a delivered parcel can still come back. Paying on the
 * day of delivery means chasing money already sent; the window is the cheap
 * version of that problem.
 */
export function commissionState(input: CommissionStateInput): CommissionState {
  const holdDays = input.holdDays ?? DEFAULT_HOLD_DAYS;
  const now = input.now ?? new Date();

  if (input.cancelled) return { status: "Void", reason: "The order was cancelled." };
  if (input.fullyRefunded) return { status: "Void", reason: "The order was refunded in full." };
  if (VOID_STATES.includes(input.delivery)) {
    return { status: "Void", reason: `The parcel came back as ${input.delivery.toLowerCase()}, so no money was kept for it.` };
  }

  if (input.delivery !== EARNING_STATE) {
    return { status: "Pending", reason: "Commission is earned when the parcel is delivered." };
  }

  if (input.amount <= 0) {
    return { status: "Void", reason: "Nothing was received for this order once discounts and refunds were counted." };
  }

  // A courier that reports a delivery without a date still starts the clock —
  // from the moment we learned of it. Stranding a rep's earnings because
  // Shiprocket omitted a timestamp is not a policy anybody chose.
  const deliveredAt = input.deliveredAt ? new Date(input.deliveredAt) : now;
  const maturesAt = addDays(deliveredAt, holdDays);

  return now >= maturesAt
    ? { status: "Payable", maturesAt }
    : { status: "Maturing", maturesAt, reason: `Clears ${holdDays} days after delivery.` };
}

/**
 * The status to store, given the one already there.
 *
 * A commission a payout run has claimed keeps both its status and its figure:
 * the run is a document somebody approved, and recomputing what it contains
 * underneath it would make an approval meaningless. Releasing it is the run's
 * own business — deleting or reopening a draft hands its commissions back, and
 * they are recomputed then.
 */
export const nextStatus = (current: CommissionStatus | undefined, computed: CommissionStatus): CommissionStatus =>
  current && COMMITTED_STATUSES.includes(current) ? current : computed;

/**
 * A commission already promised that has since gone bad — the parcel came back
 * after it was approved, or after it was paid.
 *
 * This is the hole a seven-day hold leaves open, and the only honest thing to do
 * with it is show it. Nothing is reversed automatically: money that has left the
 * company is recovered by agreement, not by a background job editing a run.
 */
export const needsReversal = (current: CommissionStatus | undefined, computed: CommissionStatus) =>
  Boolean(current && COMMITTED_STATUSES.includes(current) && computed === "Void");

// ------------------------------------------------------------ the whole order

/**
 * An order, reduced to what the commission depends on. Structural rather than
 * the mongoose document, so this stays pure and the test can pass a literal.
 */
export type CommissionOrderLike = {
  /** Which rule applies, by coupon suffix. */
  ruleSuffix?: string | null;
  items: OrderLine[];
  cancelledAt?: Date | null;
  fullyRefunded?: boolean;
  shipment?: { deliveredAt?: Date | null } | null;
  delivery: { reported?: DeliveryState; override?: DeliveryState | null; state?: DeliveryState };
  commission: {
    rate?: number; base?: number; amount?: number;
    status?: CommissionStatus; maturesAt?: Date | null;
    wholeOrderFallback?: boolean; reason?: string | null;
    needsReversal?: boolean; computedAt?: Date | null;
  };
};

/**
 * Brings an order's cached commission back in step with everything it depends
 * on: the courier's latest word, a refund, a rule somebody edited.
 *
 * **This is the only function that writes `order.commission`** (§4.4). Anything
 * that changes a delivery state, a refund or a rule calls it and saves; nothing
 * else sets those fields by hand, or the figure on the screen and the figure in
 * the payout drift apart.
 *
 * Note what it will not do: a commission a payout run has claimed keeps its
 * figure. The run is a document somebody approved, and recomputing underneath it
 * would make the approval meaningless — so instead the order is flagged
 * `needsReversal` and shown to a human.
 */
export function recalculateCommission<T extends CommissionOrderLike>(
  order: T,
  rules: readonly CommissionRule[],
  options: { holdDays?: number; now?: Date } = {}
): T {
  const now = options.now ?? new Date();

  // The override is a person's decision about what really happened; it beats
  // whatever the courier's feed says, which is the point of having one.
  const state = order.delivery.override ?? order.delivery.reported ?? "Awaiting";
  order.delivery.state = state;

  const rule = rules.find(entry => entry.active && entry.suffix === order.ruleSuffix);
  const breakdown = rule
    ? computeCommission(order.items ?? [], rule)
    : { rate: 0, base: 0, amount: 0, wholeOrderFallback: false, lines: [] };

  const computed = rule
    ? commissionState({
        delivery: state,
        deliveredAt: order.shipment?.deliveredAt,
        cancelled: Boolean(order.cancelledAt),
        fullyRefunded: order.fullyRefunded,
        amount: breakdown.amount,
        holdDays: options.holdDays,
        now
      })
    : {
        status: "Void" as CommissionStatus,
        reason: `No commission rule is set for coupon codes ending ${order.ruleSuffix ?? "—"}. Add one under Sales settings.`
      };

  const current = order.commission.status;
  order.commission.needsReversal = needsReversal(current, computed.status);
  order.commission.status = nextStatus(current, computed.status);
  order.commission.computedAt = now;

  // A claimed commission keeps the figures the run committed to. Everything
  // else is restated from what we now know.
  if (!COMMITTED_STATUSES.includes(current as CommissionStatus)) {
    order.commission.rate = breakdown.rate;
    order.commission.base = breakdown.base;
    order.commission.amount = breakdown.amount;
    order.commission.wholeOrderFallback = breakdown.wholeOrderFallback;
    order.commission.maturesAt = computed.maturesAt ?? null;
    order.commission.reason = computed.reason ?? null;
  }

  return order;
}
