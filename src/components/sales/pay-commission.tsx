"use client";

import { useState } from "react";
import { Copy } from "lucide-react";
import { Button, Field, Notice } from "@/components/ui/kit";
import { Modal } from "@/components/ui/modal";
import { PAYOUT_MODES, type PayoutMode } from "@/lib/sales/constants";
import { formatRupees, type CommissionPayment } from "@/lib/sales/types";
import { formatDate, todayIso } from "@/lib/time";

/** As much of the partner as the dialog needs to say who is being paid, and how to reach their money. */
export type PayeeLike = {
  name?: string;
  code?: string;
  phone?: string;
  payMethod?: PayoutMode | string;
  upiId?: string;
  bankName?: string;
  bankAccountName?: string;
  bankAccountNo?: string;
  bankIfsc?: string;
};

export type PayableLike = {
  _id: string;
  name?: string;
  commission: { amount: number; rate?: number; base?: number; payment?: CommissionPayment };
  rep?: PayeeLike | string | null;
};

/**
 * Marking one order's commission paid.
 *
 * The transfer itself happens on somebody's phone, so the dialog's first job is
 * to put the partner's UPI id or account number where it can be copied, and its
 * second is to write down what was done — the day, the mode, the reference.
 * Every field defaults to the ordinary case (today, the partner's own preferred
 * method) so paying a routine order is two taps.
 */
export function PayCommission({ order, onClose, onPaid }: {
  order: PayableLike;
  onClose: () => void;
  onPaid: () => void;
}) {
  const rep = typeof order.rep === "object" && order.rep ? order.rep : null;
  const preferred = (PAYOUT_MODES as readonly string[]).includes(rep?.payMethod ?? "") ? rep!.payMethod as PayoutMode : "UPI";

  const [paymentDate, setPaymentDate] = useState(todayIso());
  const [mode, setMode] = useState<PayoutMode>(preferred);
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/sales/orders/${order._id}/pay`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paymentDate, mode, reference: reference || undefined, note: note || undefined })
      });
      const json = await response.json() as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "Could not mark this commission paid");
      onPaid();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not mark this commission paid");
    } finally { setBusy(false); }
  }

  return <Modal title={`Pay ${formatRupees(order.commission.amount)} on ${order.name ?? "this order"}`}
    description={rep ? `To ${rep.name}${rep.code ? ` (${rep.code})` : ""} — send the money, then record it here` : "Send the money, then record it here"}
    onClose={onClose}
    footer={<div className="flex gap-2">
      <Button tone="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
      <Button className="flex-1" busy={busy} onClick={save}>Mark as paid</Button>
    </div>}>

    <div className="space-y-4">
      {rep && <PayeeDetails rep={rep} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Paid on">
          <input className="input" type="date" value={paymentDate} max={todayIso()}
            onChange={event => setPaymentDate(event.target.value)} />
        </Field>
        <Field label="How">
          <select className="select" value={mode} onChange={event => setMode(event.target.value as PayoutMode)}>
            {PAYOUT_MODES.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </Field>
      </div>

      <Field label="Reference" hint="The UTR or UPI transaction id — the partner sees this and can match it on their side.">
        <input className="input" value={reference} maxLength={80} placeholder="e.g. 4217XXXXXXXX"
          onChange={event => setReference(event.target.value)} />
      </Field>

      <Field label="Note" hint="Optional. Shown to the partner too.">
        <input className="input" value={note} maxLength={300} onChange={event => setNote(event.target.value)} />
      </Field>

      {error && <Notice tone="error">{error}</Notice>}
    </div>
  </Modal>;
}

/**
 * Where the money goes, laid out to be copied from.
 *
 * The full account number is shown here and nowhere else in the payments flow:
 * this is the moment somebody is actually about to type it into a bank app,
 * and hiding all but four digits would send them to the partner's record to
 * find the rest.
 */
function PayeeDetails({ rep }: { rep: PayeeLike }) {
  const upi = rep.payMethod === "UPI" || !rep.payMethod;
  const rows: { label: string; value?: string }[] = upi
    ? [{ label: "UPI id", value: rep.upiId }, { label: "Phone", value: rep.phone }]
    : [
        { label: "Account name", value: rep.bankAccountName },
        { label: "Account no.", value: rep.bankAccountNo },
        { label: "IFSC", value: rep.bankIfsc },
        { label: "Bank", value: rep.bankName },
        { label: "Phone", value: rep.phone }
      ];
  const known = rows.filter(row => row.value);

  return <div className="rounded-[10px] border border-[var(--line)] bg-[var(--surface-2)] p-3">
    <p className="text-xs font-semibold text-[var(--muted)]">Pays by {rep.payMethod ?? "UPI"}</p>
    {known.length ? (
      <dl className="mt-2 space-y-1.5">
        {known.map(row => <CopyRow key={row.label} label={row.label} value={row.value!} />)}
      </dl>
    ) : (
      <p className="mt-1 text-xs text-[var(--warn-ink)]">
        No {upi ? "UPI id" : "bank details"} on file for this partner. Ask them for it, or record the payment however it was made.
      </p>
    )}
  </div>;
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return <div className="flex items-center justify-between gap-3 text-sm">
    <dt className="shrink-0 text-xs text-[var(--muted)]">{label}</dt>
    <dd className="flex min-w-0 items-center gap-2">
      <span className="truncate font-medium tabular-nums">{value}</span>
      <button type="button" aria-label={`Copy ${label}`}
        onClick={() => { navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}
        className="shrink-0 rounded p-1 text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--ink)]">
        {copied ? <span className="text-[11px] font-semibold text-[var(--ok-ink)]">Copied</span> : <Copy size={13} />}
      </button>
    </dd>
  </div>;
}

/** "Paid 12 Aug 2026 · UPI · ref 4217…" — how a settled commission reads wherever it is listed. */
export function paymentSummary(payment: CommissionPayment | undefined, options: { withPayer?: boolean } = {}): string {
  if (!payment) return "Paid";
  const payer = options.withPayer && typeof payment.paidBy === "object" && payment.paidBy?.name ? `by ${payment.paidBy.name}` : null;
  return [
    payment.paymentDate ? `Paid ${formatDate(payment.paymentDate)}` : payment.paidAt ? `Paid ${formatDate(payment.paidAt)}` : "Paid",
    payment.mode,
    payment.reference ? `ref ${payment.reference}` : null,
    payer
  ].filter(Boolean).join(" · ");
}

/** The undo, for a payment marked on the wrong order. Small on purpose. */
export function UnpayButton({ orderId, onDone, onError }: { orderId: string; onDone: () => void; onError: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  async function undo() {
    if (!window.confirm("Take this payment back? Use this only if it was marked on the wrong order or the transfer did not go through.")) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/sales/orders/${orderId}/pay`, { method: "DELETE" });
      const json = await response.json() as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "Could not take this payment back");
      onDone();
    } catch (problem) {
      onError(problem instanceof Error ? problem.message : "Could not take this payment back");
    } finally { setBusy(false); }
  }
  return <button type="button" disabled={busy} onClick={undo}
    className="text-xs font-medium text-[var(--muted)] hover:text-[var(--danger-ink)] hover:underline disabled:opacity-50">
    {busy ? "Working…" : "Undo"}
  </button>;
}
