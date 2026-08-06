"use client";

import { useState } from "react";
import { Button, Field, Notice } from "@/components/ui/kit";
import { Modal } from "@/components/ui/modal";
import { todayIso } from "@/lib/time";
import { formatMoney, PAYMENT_MODES, type PaymentMode } from "@/lib/billing/constants";

/**
 * Recording money against a bill. Used at the desk and on the rep's phone: the
 * one who takes the payment is usually the one standing in the clinic, and a
 * bill is settled in as many parts as the doctor chooses to pay in.
 */
export function PaymentForm({ invoiceId, balanceDue, onClose, onSaved }: {
  invoiceId: string;
  balanceDue: number;
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  /**
   * Deliberately empty rather than pre-filled with the whole balance. A dialog
   * that opens with the full amount already in it turns "let me look at this"
   * into "marked paid in full" with one stray tap — the figure has to be typed,
   * or chosen from the buttons below.
   */
  const [amount, setAmount] = useState(0);
  const [mode, setMode] = useState<PaymentMode>("Cash");
  const [reference, setReference] = useState("");
  const [paidAt, setPaidAt] = useState(todayIso);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (amount <= 0) { setError("Enter the amount received"); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/payments`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amount, mode, paidAt,
          reference: reference.trim() || undefined,
          notes: notes.trim() || undefined
        })
      });
      const json = await response.json() as { error?: string; data?: { balanceDue: number } };
      if (!response.ok) throw new Error(json.error ?? "Could not record this payment");
      const left = json.data?.balanceDue ?? 0;
      onSaved(left > 0
        ? `${formatMoney(amount)} recorded. ${formatMoney(left)} still outstanding.`
        : `${formatMoney(amount)} recorded. This bill is settled in full.`);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not record this payment");
      setBusy(false);
    }
  }

  return <Modal title="Record a payment" description={`${formatMoney(balanceDue)} is outstanding on this bill.`}
    onClose={onClose}
    footer={<Button onClick={submit} busy={busy} className="w-full">{busy ? "Saving…" : "Record payment"}</Button>}>
    <div className="space-y-4">
      <Field label="Amount received" hint="Part payments are fine — record each one as it comes in">
        <input type="number" min={0} max={balanceDue} step="0.01" placeholder="0.00" className="input"
          value={amount || ""} onChange={e => setAmount(Math.max(0, Number(e.target.value) || 0))} />
      </Field>

      <div className="flex flex-wrap gap-2">
        {[balanceDue, Math.round((balanceDue / 2) * 100) / 100].map((value, index) => (
          <button key={index} type="button" onClick={() => setAmount(value)}
            className="rounded-full border border-[var(--line-2)] px-3 py-1.5 text-xs font-semibold">
            {index === 0 ? `Full ${formatMoney(value)}` : `Half ${formatMoney(value)}`}
          </button>
        ))}
      </div>

      {amount > 0 && (
        <p className="rounded-[10px] bg-[var(--surface-2)] px-3 py-2.5 text-sm">
          {amount + 0.005 >= balanceDue
            ? <>This settles the bill in full.</>
            : <>{formatMoney(balanceDue - amount)} will still be outstanding.</>}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Mode">
          <select value={mode} onChange={e => setMode(e.target.value as PaymentMode)} className="select">
            {PAYMENT_MODES.map(value => <option key={value}>{value}</option>)}
          </select>
        </Field>
        <Field label="Received on">
          <input type="date" max={todayIso()} value={paidAt} onChange={e => setPaidAt(e.target.value)} className="input" />
        </Field>
      </div>

      <Field label="Reference" hint="Cheque number, UPI reference or transaction ID">
        <input value={reference} onChange={e => setReference(e.target.value)} className="input" />
      </Field>
      <Field label="Notes (optional)">
        <textarea value={notes} onChange={e => setNotes(e.target.value)} className="textarea" />
      </Field>

      {error && <Notice tone="error">{error}</Notice>}
    </div>
  </Modal>;
}
