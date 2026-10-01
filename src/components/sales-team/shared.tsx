"use client";

import { useState } from "react";
import { Button, Field, Notice } from "@/components/ui/kit";
import { Modal } from "@/components/ui/modal";
import type { DeliveryState } from "@/lib/sales/constants";
import {
  INCENTIVE_PAY_MODES, type IncentivePayMode, type IncentiveStatus, type TeamPaymentMode, formatRupees
} from "@/lib/sales-team/orders";
import { todayIso } from "@/lib/time";

/**
 * What the sales team's screens share: the record shapes as the routes send
 * them, one way to call those routes, and the dialog that marks incentives paid
 * (used from the incentive board and from a single order alike).
 */

export type TeamOrderRow = {
  _id: string;
  name: string;
  ref?: string;
  channel?: "Shopify" | "Direct";
  shopifyOrderId?: string;
  placedAt: string;
  executive: string | { _id: string; name: string; employeeId?: string; phone?: string };
  executiveName?: string;
  lead?: string | { _id: string; name: string; phone?: string; type?: string; city?: string } | null;
  customer: { name?: string; phone?: string; email?: string; address1?: string; address2?: string; city?: string; state?: string; pinCode?: string; country?: string };
  items: Array<{ product?: string; variantId?: string; sku?: string; title: string; quantity: number; price?: number; gross?: number; otherDiscount?: number }>;
  totals: { gross: number; discount: number; paid: number };
  paymentMode: TeamPaymentMode;
  advancePaid?: number;
  paymentReference?: string;
  collectAmount?: number;
  cancelledAt?: string;
  cancelReason?: string;
  cancelledBy?: { name: string } | null;
  createdBy?: { name: string } | null;
  notes?: string;
  shipment?: {
    shiprocketOrderId?: string; shipmentId?: string; awb?: string; courier?: string; status?: string;
    deliveredAt?: string; checkedAt?: string; pickupLocation?: string; codAmount?: number;
    pickupScheduledAt?: string; processedAt?: string; processedBy?: { name: string } | null; lastError?: string;
    parcel?: { weight?: number; length?: number; breadth?: number; height?: number };
  };
  delivery: { state: DeliveryState; reported?: DeliveryState; override?: DeliveryState; overrideReason?: string; at?: string };
  incentive: {
    enabled?: boolean; type?: "Percentage" | "Flat"; value?: number; base?: number; amount: number;
    status: IncentiveStatus; reason?: string; needsReversal?: boolean;
    payment?: { paidAt?: string; paidBy?: { name: string } | null; paymentDate?: string; mode?: IncentivePayMode; reference?: string; note?: string };
  };
};

export const executiveNameOf = (order: Pick<TeamOrderRow, "executive" | "executiveName">) =>
  typeof order.executive === "object" && order.executive ? order.executive.name : order.executiveName ?? "—";

/** One call to a sales-team route: the `data` on success, a sentence thrown on failure. */
export async function call<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const response = await fetch(url, {
    method: init?.method ?? (init?.body ? "POST" : "GET"),
    headers: init?.body ? { "content-type": "application/json" } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined
  });
  const json = await response.json().catch(() => ({})) as { data?: T; error?: string };
  if (!response.ok) throw new Error(json.error ?? "Something went wrong. Please try again.");
  return json.data as T;
}

export const messageOf = (error: unknown, fallback = "Something went wrong. Please try again.") =>
  error instanceof Error ? error.message : fallback;

/** `Paid ₹450 by UPI on 3 Oct 2026 · ref 4512…` */
export function paymentLine(payment: TeamOrderRow["incentive"]["payment"]): string {
  if (!payment) return "";
  return [
    payment.mode ? `by ${payment.mode}` : "",
    payment.paymentDate ? `on ${payment.paymentDate}` : "",
    payment.reference ? `ref ${payment.reference}` : ""
  ].filter(Boolean).join(" · ");
}

/**
 * Marking one or many incentives paid.
 *
 * The money moves outside this system — a transfer, UPI, or with the month's
 * salary — and this is the record that it did, so it asks for the date and the
 * reference somebody can find on a bank statement.
 */
export function PayIncentiveModal({ orders, onClose, onPaid }: {
  orders: Array<{ _id: string; name: string; amount: number; executive: string }>;
  onClose: () => void;
  onPaid: (message: string) => void;
}) {
  const [paymentDate, setPaymentDate] = useState(todayIso());
  const [mode, setMode] = useState<IncentivePayMode>("Bank transfer");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const total = orders.reduce((sum, order) => sum + order.amount, 0);
  const people = [...new Set(orders.map(order => order.executive))];

  async function pay() {
    setBusy(true); setError("");
    try {
      const result = await call<{ message: string }>("/api/sales-team/incentives", {
        body: { action: "pay", orderIds: orders.map(order => order._id), paymentDate, mode, reference: reference || undefined, note: note || undefined }
      });
      onPaid(result.message);
    } catch (problem) {
      setError(messageOf(problem));
      setBusy(false);
    }
  }

  return <Modal
    title={`Pay ${formatRupees(total)}`}
    description={`${orders.length} order${orders.length === 1 ? "" : "s"} · ${people.join(", ")}`}
    onClose={onClose}
    footer={<div className="flex gap-2">
      <Button tone="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
      <Button className="flex-1" busy={busy} onClick={pay}>Mark paid</Button>
    </div>}>
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Paid on"><input type="date" className="input" value={paymentDate} max={todayIso()} onChange={event => setPaymentDate(event.target.value)} /></Field>
        <Field label="How">
          <select className="select" value={mode} onChange={event => setMode(event.target.value as IncentivePayMode)}>
            {INCENTIVE_PAY_MODES.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Reference" hint="A UTR or UPI transaction id — something the executive can find on their side.">
        <input className="input" value={reference} onChange={event => setReference(event.target.value)} />
      </Field>
      <Field label="Note"><input className="input" value={note} onChange={event => setNote(event.target.value)} placeholder="Optional" /></Field>
      <Notice>Only orders that are delivered and not yet paid are marked. Anything else in the selection is left alone and counted in the reply.</Notice>
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  </Modal>;
}

/** Indian states and union territories, for the address form's suggestions. */
export const INDIAN_STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana",
  "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur",
  "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana",
  "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal", "Andaman and Nicobar Islands", "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry"
];
