"use client";

import { useRef, useState } from "react";
import { ExternalLink, Paperclip } from "lucide-react";
import { Button, Field, Notice } from "@/components/ui/kit";
import { Modal } from "@/components/ui/modal";
import { ACCEPT_ATTRIBUTE, formatBytes, MAX_VAULT_FILE_BYTES, resolveFileType, sizeLimitText } from "@/lib/finance/files";
import { formatPeriod } from "@/lib/finance/period";
import { sourceOf, type SourceKey } from "@/lib/finance/sources";

/**
 * Filing a bill that arrived by hand.
 *
 * The form is built around one belief: the file is the record and everything
 * else is a nicety. Somebody with a Razorpay invoice open in another tab should
 * be able to drop it in and be done, and every field they are *made* to fill in
 * first is a chance for them to close the tab instead. So the file is required
 * and nothing else is — the figures can be typed onto the row later, and a
 * filed invoice with no amount is worth immeasurably more to the accountant
 * than an amount with no invoice.
 *
 * The link to the vendor's own billing page sits inside the dialog rather than
 * beside it, because the honest workflow is: open this, realise you have not
 * downloaded the file yet, follow the link, come back.
 */
export function UploadInvoice({ period, source, onClose, onFiled }: {
  period: string;
  source: SourceKey;
  onClose: () => void;
  onFiled: (message: string, note?: string) => void;
}) {
  const details = sourceOf(source);
  const picker = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [number, setNumber] = useState("");
  const [documentDate, setDocumentDate] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [taxAmount, setTaxAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  /**
   * Refused here as well as on the server, and for a different reason: the
   * server refuses to protect the database, this refuses to protect somebody's
   * connection. A 30 MB scan rejected after it has been uploaded is thirty
   * seconds of a phone tether spent on nothing.
   */
  function choose(chosen: File | null) {
    setError(null);
    if (!chosen) return setFile(null);

    if (chosen.size > MAX_VAULT_FILE_BYTES) {
      return setError(`${chosen.name} is ${formatBytes(chosen.size)}. The file must be ${sizeLimitText(MAX_VAULT_FILE_BYTES)}.`);
    }
    if (!resolveFileType(chosen.type, chosen.name)) {
      return setError("File a PDF, an image, or a CSV or Excel export.");
    }
    setFile(chosen);
  }

  async function submit() {
    if (!file) return setError("Choose the invoice file to file.");
    setError(null);

    const form = new FormData();
    form.set("file", file);
    form.set("period", period);
    form.set("source", source);
    for (const [key, value] of Object.entries({ number, documentDate, description, amount, taxAmount, notes })) {
      if (value.trim()) form.set(key, value.trim());
    }

    const response = await fetch("/api/finance/documents", { method: "POST", body: form });
    const json = await response.json() as { data?: { message: string; note?: string }; error?: string };
    if (!response.ok) return setError(json.error ?? "Could not file that invoice.");

    onFiled(json.data?.message ?? "Filed.", json.data?.note);
  }

  return <Modal
    title={`File a ${details.label.toLowerCase()}`}
    description={`${details.vendor} · ${formatPeriod(period)}`}
    onClose={onClose}
    footer={<div className="flex justify-end gap-2">
      <Button tone="ghost" onClick={onClose}>Cancel</Button>
      <Button onClick={submit} disabled={!file}>File it</Button>
    </div>}
  >
    <div className="space-y-4">
      <p className="text-sm text-[var(--muted)]">{details.blurb}</p>

      {details.billingUrl && <a href={details.billingUrl} target="_blank" rel="noreferrer"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--brand)] hover:underline">
        Open {details.vendor}&rsquo;s billing page <ExternalLink size={14} />
      </a>}

      <button type="button" onClick={() => picker.current?.click()}
        className="flex w-full items-center gap-3 rounded-[10px] border border-dashed border-[var(--line-2)] px-4 py-5 text-left transition-colors hover:bg-[var(--surface-2)]">
        <Paperclip size={18} className="shrink-0 text-[var(--muted)]" />
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{file ? file.name : "Choose the file"}</span>
          <span className="block text-xs text-[var(--muted)]">
            {file ? formatBytes(file.size) : `PDF, image, CSV or Excel — ${sizeLimitText(MAX_VAULT_FILE_BYTES)}`}
          </span>
        </span>
      </button>
      <input ref={picker} type="file" accept={ACCEPT_ATTRIBUTE} className="hidden"
        onChange={event => choose(event.target.files?.[0] ?? null)} />

      {error && <Notice tone="error">{error}</Notice>}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Invoice number" hint="As the vendor prints it">
          <input className="input" value={number} onChange={event => setNumber(event.target.value)} placeholder="Optional" />
        </Field>
        <Field label="Document date" hint="Leave blank if it is not on the bill">
          <input type="date" className="input" value={documentDate} onChange={event => setDocumentDate(event.target.value)} />
        </Field>
        <Field label="Amount (₹)">
          <input type="number" min="0" step="0.01" inputMode="decimal" className="input"
            value={amount} onChange={event => setAmount(event.target.value)} placeholder="Optional" />
        </Field>
        <Field label="Of which tax (₹)" hint="What the input credit is claimed on">
          <input type="number" min="0" step="0.01" inputMode="decimal" className="input"
            value={taxAmount} onChange={event => setTaxAmount(event.target.value)} placeholder="Optional" />
        </Field>
      </div>

      <Field label="Description" hint="What this bill is for, if the number does not say">
        <input className="input" value={description} onChange={event => setDescription(event.target.value)} placeholder="Optional" />
      </Field>

      <Field label="Note for the accountant">
        <textarea className="textarea" value={notes} onChange={event => setNotes(event.target.value)} placeholder="Optional" />
      </Field>
    </div>
  </Modal>;
}
