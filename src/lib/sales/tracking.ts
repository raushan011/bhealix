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
 * maintains, so this can never disagree with what the administrator pays — it
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
    reason?: string;
    payment?: { paidAt?: string | Date | null; paymentDate?: string | null; mode?: string | null; reference?: string | null } | null;
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
    case "Payable": return "Delivered. Your commission is ready and waiting to be paid.";
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
 * Always five steps, whatever happened. A parcel that came back does not get a
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

  // 5. The money. Delivered is owed, and owed is paid by hand one order at a
  //    time — so between delivery and payment the step sits at "current" with
  //    the amount, and once paid it carries the day, the mode and the reference
  //    the partner can find on their own side.
  const payment = order.commission.payment;
  steps.push({
    key: "paid-out",
    label: commission === "Paid" ? "Paid to you"
      : commission === "Void" || dead ? "Earns nothing"
      : commission === "Payable" ? "Ready to be paid"
      : "Commission",
    state: commission === "Paid" ? "done"
      : commission === "Void" || dead ? "failed"
      : commission === "Payable" ? "current"
      : "waiting",
    at: commission === "Paid" ? iso(payment?.paidAt) : undefined,
    detail: commission === "Paid"
      ? [payment?.mode, payment?.reference ? `ref ${payment.reference}` : undefined].filter(Boolean).join(" · ") || undefined
      : commission === "Void"
        ? order.commission.reason || "The parcel did not stay with the customer."
        : commission === "Payable"
          ? "Delivered. The company pays this by UPI or bank transfer and marks it here when it has."
          : commission === "Pending"
            ? "Earned when the parcel is delivered."
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
