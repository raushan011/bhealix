"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";

/**
 * Downloads the bill as a PDF.
 *
 * Fetched rather than linked, even though the route already answers with
 * `Content-Disposition: attachment`: a link that fails navigates the tab to a
 * page of JSON, and the two ways this can fail — a bill somebody may not read,
 * a session that expired in another tab — both deserve a sentence on the
 * screen the person is already looking at.
 */
export function DownloadInvoice({ invoiceId, invoiceNo, onError }: {
  invoiceId: string;
  invoiceNo: string;
  onError?: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function download() {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/pdf`);
      if (!response.ok) {
        const json = await response.json().catch(() => null) as { error?: string } | null;
        onError?.(json?.error ?? "Could not prepare the PDF. Please try again.");
        return;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileNameFrom(response.headers.get("content-disposition"))
        ?? `${invoiceNo.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "invoice"}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Released on a delay: revoking it in the same tick cancels the save in
      // browsers that have not finished reading the blob when the click returns.
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch {
      onError?.("The download did not go through — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return <button type="button" onClick={download} disabled={busy} aria-busy={busy}
    className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-[10px] border border-[var(--line-2)] bg-[var(--surface)] px-4 text-sm font-semibold disabled:opacity-60">
    {busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
    {busy ? "Preparing…" : "Download"}
  </button>;
}

/** `attachment; filename="BHX-2026-27-0005.pdf"` — the name the server chose. */
function fileNameFrom(header: string | null): string | null {
  const match = header ? /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header) : null;
  return match ? decodeURIComponent(match[1]) : null;
}
