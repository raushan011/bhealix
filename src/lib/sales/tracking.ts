import { VOID_STATES, type CommissionStatus, type DeliveryState } from "./constants";

/**
 * One order told as a sequence, because that is the question a rep actually
 * asks.
 *
 * The admin screens show an order as two badges — a delivery state and a
 * commission status — which is exactly right for somebody scanning two hundred
 * rows for the one that has gone wrong. It is the wrong shape for the person
 * who brought the order in. They have one order in mind and one question about
 * it: *where has it got to, and when do I get my money.* A pair of nouns does
 * not answer that; a line of steps with the finished ones behind and the next
 * one named does.
 *
 * Nothing new is stored. Every step is read off fields the sync already
 * maintains, so this can never disagree with what the payout run will pay — it
 * is the same facts, arranged for a different reader.
 *
 * Pure and tested, like the commission arithmetic it narrates.
 */

export type StepState =
  /** Behind us. */
  | "done"
  /** Where the order is now — the one line a rep reads. */
  | "current"
  /** Ahead of it, and still expected. */
  | "waiting"
  /** Ahead of it, and never coming: the parcel came back, or the money was voided. */
  | "failed";

export type TrackStep = {
  key: string;
  label: string;
  state: StepState;
  /** When it happened, where we know. */
  at?: string;
  /** The one line of context worth having — the courier, the clearing date. */
  detail?: string;
};

export type TrackableOrder = {
  placedAt: string | Date;
  financialStatus?: string;
  paymentMethod?: string;
  cancelledAt?: string | Date | null;
  shipment?: {
    awb?: string;
    courier?: string;
    status?: string;
    deliveredAt?: string | Date | null;
  } | null;
  delivery: { state: DeliveryState; at?: string | Date | null };
  commission: {
    status: CommissionStatus;
    amount: number;
    maturesAt?: string | Date | null;
    reason?: string;
  };
};

const iso = (value: string | Date | null | undefined): string | undefined =>
  value ? new Date(value).toISOString() : undefined;

const isVoid = (state: DeliveryState) => (VOID_STATES as readonly DeliveryState[]).includes(state);

/**
 * Shopify's word for where the money is. `paid` is the ordinary case;
 * `pending` is cash on delivery, which stays pending until the parcel is
 * handed over. A refund still means the money arrived once, so the step is
 * behind us — what the refund did to the commission is said further down the
 * line, where it belongs.
 */
const SETTLED = ["paid", "partially_refunded", "refunded"];
const paidFor = (order: TrackableOrder) => SETTLED.includes((order.financialStatus ?? "").toLowerCase());

/** Whether the parcel demonstrably left the warehouse, including the ones that came back. */
const shipped = (order: TrackableOrder) =>
  order.delivery.state === "In transit" ||
  order.delivery.state === "Delivered" ||
  order.delivery.state === "Undelivered" ||
  order.delivery.state === "RTO" ||
  order.delivery.state === "Returned" ||
  order.delivery.state === "Lost" ||
  Boolean(order.shipment?.awb);

/**
 * The line a rep reads first: where this order has got to, in one sentence.
 *
 * Written from the rep's side of the transaction throughout — "you will be paid",
 * not "the commission matures" — because the audience for it is a beautician
 * with a phone, not the finance desk.
 */
export function trackingHeadline(order: TrackableOrder): string {
  const state = order.delivery.state;

  if (state === "Cancelled") return "This order was cancelled, so nothing is owed on it.";
  if (state === "RTO" || state === "Returned") return "The parcel came back, so this order earns nothing.";
  if (state === "Lost") return "The courier lost this parcel. The company settles these by hand — ask if it has been a while.";

  switch (order.commission.status) {
    case "Paid": return "Paid to you.";
    case "In payout": return "On the current payout run — the amount is fixed and the money is on its way.";
    case "Payable": return "Cleared and payable. It will be on the next payout run.";
    case "Maturing": return "Delivered. Your commission clears once the return window closes.";
    case "Void": return order.commission.reason || "This order earns nothing.";
    default: break;
  }

  if (state === "Undelivered") return "Delivery was attempted and failed. The courier will normally try again.";
  if (state === "Delivered") return "Delivered.";
  if (shipped(order)) return "On its way to the customer.";
  return "Placed. It has not been dispatched yet.";
}

/**
 * The whole journey, from the order being placed to the money reaching the rep.
 *
 * Always six steps, whatever happened. A parcel that came back does not get a
 * shorter list — it gets the same list with the remaining steps marked as never
 * coming, which is the honest picture and the one that stops somebody waiting
 * for a payment that was never going to arrive.
 */
export function trackOrder(order: TrackableOrder): TrackStep[] {
  const state = order.delivery.state;
  const commission = order.commission.status;
  const dead = isVoid(state) || commission === "Void";
  const cancelled = state === "Cancelled";
  const hasShipped = shipped(order);
  const delivered = state === "Delivered";

  const steps: TrackStep[] = [];

  // 1. Placed. The only step that is unconditionally behind us — the order
  //    exists, which is why there is anything to show.
  steps.push({
    key: "placed",
    label: "Order placed",
    state: "done",
    at: iso(order.placedAt),
    detail: "Your coupon was used at the checkout."
  });

  // 2. Money. Cash on delivery sits here until the parcel is handed over, and
  //    saying so beats a rep reading "payment pending" as a customer who has
  //    not paid.
  const cod = /cash|cod/i.test(order.paymentMethod ?? "");
  steps.push({
    key: "paid",
    label: paidFor(order) ? "Payment received" : cod ? "Pays on delivery" : "Payment pending",
    state: paidFor(order) ? "done" : cancelled ? "failed" : "current",
    detail: order.paymentMethod || (cod ? "Cash on delivery" : undefined)
  });

  // 3. Dispatch. `Fulfilled` is a label existing, not a parcel arriving — the
  //    distinction the whole commission rule rests on — so this step is only
  //    ever about the parcel leaving.
  const courier = [order.shipment?.courier, order.shipment?.awb].filter(Boolean).join(" · ");
  steps.push({
    key: "shipped",
    label: hasShipped ? "Dispatched" : "Awaiting dispatch",
    state: hasShipped ? "done" : cancelled ? "failed" : "current",
    detail: courier || (cancelled ? "Cancelled before it was dispatched." : undefined)
  });

  // 4. Arrival — the step that decides whether anybody earns anything.
  steps.push({
    key: "delivered",
    label: delivered ? "Delivered" : dead ? deadLabel(state) : "Out for delivery",
    state: delivered ? "done" : dead ? "failed" : hasShipped ? "current" : "waiting",
    at: iso(order.shipment?.deliveredAt ?? (delivered ? order.delivery.at : undefined)),
    detail: state === "Undelivered" ? "A delivery attempt failed. The courier usually tries again." : undefined
  });

  // 5. The hold. A delivered parcel is not yet money: the return window has to
  //    close first, and the date it closes is the single most-asked question in
  //    this portal.
  const cleared = commission === "Payable" || commission === "In payout" || commission === "Paid";
  steps.push({
    key: "cleared",
    label: cleared ? "Commission cleared" : commission === "Void" ? "Earns nothing" : "Clearing",
    state: cleared ? "done" : commission === "Void" || dead ? "failed" : commission === "Maturing" ? "current" : "waiting",
    at: cleared ? undefined : iso(order.commission.maturesAt),
    detail: commission === "Maturing" && order.commission.maturesAt
      ? "The return window closes on this date, and the amount becomes payable."
      : commission === "Void"
        ? order.commission.reason || "The parcel did not stay with the customer."
        : commission === "Pending"
          ? "Clears once the parcel is delivered and the return window has passed."
          : undefined
  });

  // 6. The money. `In payout` is deliberately its own resting place rather than
  //    a kind of "nearly paid": once a run has claimed a commission the figure
  //    is frozen and the run is what honours it.
  steps.push({
    key: "paid-out",
    label: commission === "Paid" ? "Paid to you" : "Payout",
    state: commission === "Paid" ? "done"
      : commission === "Void" || dead ? "failed"
      : commission === "In payout" ? "current"
      : "waiting",
    detail: commission === "In payout"
      ? "On a payout run. The amount is fixed and will not change."
      : commission === "Payable"
        ? "Waiting for the next payout run."
        : undefined
  });

  return steps;
}

const deadLabel = (state: DeliveryState): string => {
  switch (state) {
    case "Cancelled": return "Cancelled";
    case "RTO": return "Returned to sender";
    case "Returned": return "Returned by the customer";
    case "Lost": return "Lost by the courier";
    default: return "Not delivered";
  }
};

/** Where the order has got to, as a fraction — for a progress bar, nothing more. */
export const trackingProgress = (steps: TrackStep[]): number =>
  Math.round((steps.filter(step => step.state === "done").length / steps.length) * 100);
