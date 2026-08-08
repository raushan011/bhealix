"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { ExternalLink, FileText, Paperclip, Trash2 } from "lucide-react";
import { Button, Notice } from "@/components/ui/kit";
import { Modal } from "@/components/ui/modal";
import { formatDate } from "@/lib/time";
import { formatMoney } from "@/lib/billing/constants";
import {
  formatBytes, isPdf, MAX_PROOF_BYTES, PROOF_TYPES, sizeLimitText
} from "@/lib/billing/attachments";
import type { InvoicePayment } from "@/lib/billing/types";

const ACCEPTED: readonly string[] = PROOF_TYPES;

/**
 * The evidence for one receipt: the screenshot of the transfer, the photograph
 * of the cheque, the bank advice.
 *
 * A receipt is somebody typing a number into a form, and a month later the only
 * question that matters is whether the money actually arrived. The file answers
 * it, so it sits on the receipt it belongs to rather than in an inbox somewhere.
 */
export function PaymentProof({ invoiceId, payment, mayAttach, mayManage, userId, onChanged }: {
  invoiceId: string;
  payment: InvoicePayment;
  /** Whether this person may attach a file to this receipt at all. */
  mayAttach: boolean;
  /** An administrator may replace or remove anybody's proof; a rep only their own. */
  mayManage: boolean;
  userId: string;
  onChanged: (notice: { tone: "success" | "error"; text: string }) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [viewing, setViewing] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const proof = payment.proof ?? null;
  const mine = !proof?.uploadedBy || String(proof.uploadedBy._id ?? "") === userId;
  const mayChange = mayAttach && (mayManage || mine);
  const source = `/api/invoices/${invoiceId}/payments/${payment._id}/proof`;
  // The file is cached privately for an hour, so a replaced proof would keep
  // showing the one it replaced. Stamped with the upload time, it cannot.
  const view = `${source}?v=${encodeURIComponent(proof?.uploadedAt ?? "")}`;

  async function upload(file: File | undefined) {
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) { setError("Attach a JPEG, PNG or WebP image, or a PDF"); return; }
    if (file.size > MAX_PROOF_BYTES) { setError(`The proof must be ${sizeLimitText(MAX_PROOF_BYTES)}`); return; }

    setBusy(true); setError("");
    try {
      const body = new FormData();
      body.append("proof", file, file.name);
      const response = await fetch(source, { method: "POST", body });
      const json = await response.json() as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "Could not attach that file");
      onChanged({ tone: "success", text: `Proof attached to the ${formatMoney(payment.amount)} receipt.` });
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not attach that file");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function remove() {
    if (!window.confirm("Remove the proof attached to this receipt? The receipt itself stays.")) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(source, { method: "DELETE" });
      const json = await response.json() as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "Could not remove that file");
      setViewing(false);
      onChanged({ tone: "success", text: "Proof removed." });
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not remove that file");
    } finally { setBusy(false); }
  }

  return <div className="mt-1.5 space-y-1.5">
    <div className="flex flex-wrap items-center gap-1.5">
      {proof ? (
        // A PDF opens in its own tab, where the browser's reader can handle it;
        // an image opens here, which is one tap instead of a page change.
        isPdf(proof.contentType) ? (
          <a href={view} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--ok-bg)] px-2.5 py-1 text-[11px] font-semibold text-[var(--ok-ink)]">
            <FileText size={12} />Proof (PDF)<ExternalLink size={11} />
          </a>
        ) : (
          <button type="button" onClick={() => setViewing(true)}
            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--ok-bg)] px-2.5 py-1 text-[11px] font-semibold text-[var(--ok-ink)]">
            <Paperclip size={12} />View proof
          </button>
        )
      ) : mayAttach ? (
        <button type="button" disabled={busy} onClick={() => input.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-[var(--line-2)] px-2.5 py-1 text-[11px] font-semibold text-[var(--muted)] disabled:opacity-50">
          <Paperclip size={12} />{busy ? "Attaching…" : "Attach proof"}
        </button>
      ) : (
        <span className="text-[11px] text-[var(--muted)]">No proof attached</span>
      )}

      {proof && mayChange && (
        <button type="button" disabled={busy} onClick={() => input.current?.click()}
          className="text-[11px] font-semibold text-[var(--brand)] disabled:opacity-50">
          {busy ? "Working…" : "Replace"}
        </button>
      )}
    </div>

    {mayAttach && (
      <input ref={input} type="file" accept={ACCEPTED.join(",")} className="hidden"
        onChange={event => upload(event.target.files?.[0])} />
    )}

    {error && <p className="text-[11px] font-medium text-[var(--danger-ink)]">{error}</p>}

    {viewing && proof && (
      <Modal title="Proof of payment"
        description={`${formatMoney(payment.amount)} · ${payment.mode} · ${formatDate(payment.paidAt)}`}
        onClose={() => setViewing(false)}
        footer={mayChange
          ? <Button tone="danger" className="w-full" busy={busy} onClick={remove}>
              <Trash2 size={15} />Remove this proof
            </Button>
          : undefined}>
        <div className="space-y-3">
          <Image src={view} alt="The file attached as proof of this payment"
            width={1600} height={1200} unoptimized className="h-auto w-full rounded-[10px]" />
          <p className="text-xs text-[var(--muted)]">
            {[proof.fileName, formatBytes(proof.bytes),
              proof.uploadedBy?.name && `attached by ${proof.uploadedBy.name}`,
              proof.uploadedAt && formatDate(proof.uploadedAt)].filter(Boolean).join(" · ")}
          </p>
          {!mayChange && <Notice tone="info">Only an administrator can replace or remove this file.</Notice>}
        </div>
      </Modal>
    )}
  </div>;
}
