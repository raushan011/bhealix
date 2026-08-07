"use client";

import { useRef, useState } from "react";
import { Paperclip, X } from "lucide-react";
import { Button, Field, Notice } from "@/components/ui/kit";
import { Modal } from "@/components/ui/modal";
import { todayIso } from "@/lib/time";
import { formatMoney, PAYMENT_MODES, type PaymentMode } from "@/lib/billing/constants";
import { formatBytes, MAX_PROOF_BYTES, PROOF_TYPES, sizeLimitText } from "@/lib/billing/attachments";

const ACCEPTED: readonly string[] = PROOF_TYPES;

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
  const [proof, setProof] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);

  function chooseProof(file: File | undefined) {
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) { setError("Attach a JPEG, PNG or WebP image, or a PDF"); return; }
    if (file.size > MAX_PROOF_BYTES) { setError(`The proof must be ${sizeLimitText(MAX_PROOF_BYTES)}`); return; }
    setError(""); setProof(file);
  }

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
      const json = await response.json() as { error?: string; data?: { balanceDue: number; payment?: string } };
      if (!response.ok) throw new Error(json.error ?? "Could not record this payment");

      const left = json.data?.balanceDue ?? 0;
      const recorded = left > 0
        ? `${formatMoney(amount)} recorded. ${formatMoney(left)} still outstanding.`
        : `${formatMoney(amount)} recorded. This bill is settled in full.`;

      /*
        The file is a second request, sent once the receipt it belongs to
        exists. A failure here is reported rather than thrown: the money has
        already been recorded and re-submitting the form to retry the upload
        would record it twice. The proof can be attached from the bill itself.
      */
      let attached = "";
      if (proof && json.data?.payment) {
        const body = new FormData();
        body.append("proof", proof, proof.name);
        const upload = await fetch(`/api/invoices/${invoiceId}/payments/${json.data.payment}/proof`, { method: "POST", body });
        const result = await upload.json() as { error?: string };
        attached = upload.ok
          ? " Proof attached."
          : ` The payment is saved, but the proof did not upload — ${result.error ?? "try attaching it from the bill"}.`;
      }

      onSaved(recorded + attached);
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

      {/*
        Attached here rather than only afterwards, because this is the one
        moment somebody is holding the evidence: the UPI screen is still open
        on the phone that is recording the payment.
      */}
      <div>
        <p className="mb-1.5 text-[13px] font-medium text-[var(--ink-2)]">Proof of payment</p>
        {proof ? (
          <div className="flex items-center gap-2 rounded-[10px] border border-[var(--line-2)] px-3 py-2.5">
            <Paperclip size={14} className="shrink-0 text-[var(--muted)]" />
            <span className="min-w-0 flex-1 truncate text-sm">{proof.name}</span>
            <span className="shrink-0 text-xs text-[var(--muted)]">{formatBytes(proof.size)}</span>
            <button type="button" aria-label="Remove this file" onClick={() => setProof(null)}
              className="grid size-7 shrink-0 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--surface-2)]">
              <X size={14} />
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => input.current?.click()}
            className="flex w-full items-center gap-2 rounded-[10px] border border-dashed border-[var(--line-2)] px-3 py-2.5 text-sm text-[var(--muted)]">
            <Paperclip size={14} />Attach a screenshot, photo or PDF
          </button>
        )}
        <span className="mt-1 block text-xs text-[var(--muted)]">
          Optional, but a transfer is far easier to trace later with the screenshot on it.
        </span>
        <input ref={input} type="file" accept={ACCEPTED.join(",")} className="hidden"
          onChange={event => chooseProof(event.target.files?.[0])} />
      </div>

      <Field label="Notes (optional)">
        <textarea value={notes} onChange={e => setNotes(e.target.value)} className="textarea" />
      </Field>

      {error && <Notice tone="error">{error}</Notice>}
    </div>
  </Modal>;
}
