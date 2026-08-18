import { Types } from "mongoose";
import { SalesOrder } from "@/models/Sales";
import type { CommissionStatus, PayoutMode } from "./constants";
import { recalculateCommission } from "./commission";
import { loadSettings, rulesOf } from "./settings";

/**
 * Paying one order's commission, and taking the payment back when it was
 * recorded in error.
 *
 * The money itself never passes through here. An administrator sends it by UPI
 * or bank transfer from their own phone, then presses Pay on the order and says
 * when, how and under what reference. This module is the record of that — one
 * order, one payment, one line in the audit trail — and the partner's screen is
 * drawn from the same fields, so what they are told they were paid is what was
 * written down when it was paid.
 */

export type CommissionPaymentInput = {
  /** The day the money left, `yyyy-mm-dd`. */
  paymentDate: string;
  mode: PayoutMode;
  reference?: string;
  note?: string;
};

/** Only a delivered, unpaid commission can be paid. */
export const canPayCommission = (status: CommissionStatus | undefined) => status === "Payable";

/** A payment can be taken back only while it is the last thing that happened to the order. */
export const canUnpayCommission = (status: CommissionStatus | undefined) => status === "Paid";

type Outcome =
  | { ok: true; order: { _id: unknown; name?: string; rep?: unknown; commission: { amount?: number; status?: string } } }
  | { ok: false; reason: string; status?: number };

/**
 * Marks one order's commission paid.
 *
 * The write is a single conditional `updateOne` on `status: "Payable"`, and that
 * is the whole safety of it: two administrators pressing Pay on the same order
 * at the same moment cannot both succeed, because whichever reaches the database
 * second matches nothing and is told the order was already paid. Nothing is
 * read-then-written.
 */
export async function payCommission(orderId: string, actorId: string, payment: CommissionPaymentInput): Promise<Outcome> {
  const existing = await SalesOrder.findById(orderId).select("name rep commission").lean() as
    { _id: unknown; name?: string; rep?: unknown; commission?: { status?: CommissionStatus; amount?: number } } | null;
  if (!existing) return { ok: false, reason: "No such order", status: 404 };
  if (!existing.rep) return { ok: false, reason: `${existing.name ?? "This order"} is not attributed to any partner, so there is nobody to pay.` };
  if (!canPayCommission(existing.commission?.status)) return { ok: false, reason: refusalFor(existing.name, existing.commission?.status) };

  const result = await SalesOrder.updateOne(
    { _id: new Types.ObjectId(orderId), "commission.status": "Payable" },
    {
      $set: {
        "commission.status": "Paid",
        "commission.payment": {
          paidAt: new Date(),
          paidBy: new Types.ObjectId(actorId),
          paymentDate: payment.paymentDate,
          mode: payment.mode,
          reference: payment.reference || undefined,
          note: payment.note || undefined
        }
      }
    }
  );

  if (!result.modifiedCount) return { ok: false, reason: `${existing.name ?? "This order"} was paid a moment ago by somebody else.`, status: 409 };

  return {
    ok: true,
    order: { _id: existing._id, name: existing.name, rep: existing.rep, commission: { amount: existing.commission?.amount, status: "Paid" } }
  };
}

/**
 * Takes a payment back.
 *
 * For the mistake, not the reversal: the wrong order was marked, or the transfer
 * bounced. The order is re-priced on the way out, so a parcel that came back
 * while it was marked paid lands as `Void` rather than as money waiting to be
 * paid a second time. Money that really did leave and should not have is
 * recovered by agreement with the partner, and that is not a button.
 */
export async function unpayCommission(orderId: string): Promise<Outcome> {
  const order = await SalesOrder.findById(orderId);
  if (!order) return { ok: false, reason: "No such order", status: 404 };
  if (!canUnpayCommission(order.commission?.status)) {
    return { ok: false, reason: `${order.name ?? "This order"} has not been marked paid, so there is nothing to take back.` };
  }

  order.set("commission.status", "Payable");
  order.set("commission.payment", undefined);
  order.set("commission.needsReversal", false);

  const settings = await loadSettings();
  recalculateCommission(order, rulesOf(settings));
  await order.save();

  return {
    ok: true,
    order: { _id: order._id, name: order.name, rep: order.rep, commission: { amount: order.commission?.amount, status: order.commission?.status } }
  };
}

function refusalFor(name: string | undefined, status: CommissionStatus | undefined): string {
  const who = name ?? "This order";
  switch (status) {
    case "Paid": return `${who} has already been paid.`;
    case "Void": return `${who} earns nothing — the parcel came back, or the order was cancelled or refunded.`;
    case "Pending": return `${who} has not been delivered yet. Commission is paid on delivery.`;
    default: return `${who} cannot be paid right now.`;
  }
}

/**
 * An order's commission as the partner is shown it: everything about the
 * payment except who at the company pressed the button. Staff names are not
 * theirs to see, and nothing else in the payment record is secret from the
 * person it was paid to.
 */
export function commissionForPartner<T extends { commission?: { payment?: { paidBy?: unknown } | null } | null }>(order: T): T {
  const payment = order.commission?.payment;
  if (!payment || !("paidBy" in payment)) return order;
  const { paidBy: _paidBy, ...rest } = payment;
  void _paidBy;
  return { ...order, commission: { ...order.commission, payment: rest } };
}
