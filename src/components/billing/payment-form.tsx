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
  const [amount, setAmount] = useState(balanceDue);
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
        <input type="number" min={0} max={balanceDue} step="0.01" value={amount} className="input"
          onChange={e => setAmount(Math.max(0, Number(e.target.value) || 0))} />
      </Field>

      <div className="flex flex-wrap gap-2">
        {[balanceDue, balanceDue / 2].map((value, index) => (
          <button key={index} type="button" onClick={() => setAmount(Math.round(value * 100) / 100)}
            className="rounded-full border border-[var(--line-2)] px-3 py-1.5 text-xs font-semibold">
            {index === 0 ? `Full ${formatMoney(balanceDue)}` : `Half ${formatMoney(Math.round((balanceDue / 2) * 100) / 100)}`}
          </button>
        ))}
      </div>

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
