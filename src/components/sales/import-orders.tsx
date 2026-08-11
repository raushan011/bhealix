"use client";

import { useState } from "react";
import { AlertTriangle, Upload } from "lucide-react";
import { Badge, Button, Card, Notice } from "@/components/ui/kit";
import { Modal } from "@/components/ui/modal";
import { formatDate } from "@/lib/time";
import { formatRupees } from "@/lib/sales/types";

type Preview = {
  headers: string[];
  mapping: Record<string, string>;
  rows: number;
  usable: number;
  attributable: number;
  skipped: { reason: string; count: number }[];
  unknownCoupons: string[];
  sample: { name: string; couponCode: string; rep?: string; total: number; discount: number; delivery: string; placedAt: string }[];
};

/**
 * Importing orders from a checkout export.
 *
 * For the case the Shopify sync cannot cover: the coupons are applied in
 * Shiprocket's own checkout, and where the order lands afterwards depends on
 * how the store was wired. The checkout dashboard's own export always has them.
 *
 * Nothing is written until the preview has been read. It shows which column was
 * read as what, which rows were skipped and why, and — the line that matters —
 * any coupon on the file belonging to no rep here, because that is money
 * already spent with nobody credited for it.
 */
export function ImportOrders({ onClose, onDone }: { onClose: () => void; onDone: (message: string) => void }) {
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function send(action: "preview" | "commit") {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/sales/import", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, csv })
      });
      const json = await response.json() as { error?: string; data?: Preview & { created: number; updated: number } };
      if (!response.ok || !json.data) throw new Error(json.error ?? "Could not read that file");

      if (action === "preview") setPreview(json.data);
      else {
        const { created, updated } = json.data;
        onDone(`${created} order${created === 1 ? "" : "s"} imported${updated ? `, ${updated} updated` : ""}.`);
      }
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not read that file");
    } finally { setBusy(false); }
  }

  async function pick(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    setPreview(null);
    setError("");
    setCsv(await file.text());
  }

  return <Modal
    title="Import orders from a file"
    description="For orders the Shopify sync cannot see — export them from the Shiprocket checkout dashboard"
    onClose={onClose}
    footer={<div className="flex gap-2">
      <Button tone="secondary" className="flex-1" busy={busy && !preview} disabled={!csv} onClick={() => send("preview")}>
        {preview ? "Re-read" : "Read the file"}
      </Button>
      <Button className="flex-1" busy={busy} disabled={!preview?.attributable} onClick={() => send("commit")}>
        Import {preview?.attributable ?? 0} order{preview?.attributable === 1 ? "" : "s"}
      </Button>
    </div>}>

    <div className="space-y-4">
      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-[10px] border border-dashed border-[var(--line-2)] px-4 py-8 text-center hover:bg-[var(--surface-2)]">
        <Upload size={22} className="text-[var(--muted)]" />
        <span className="text-sm font-medium">{fileName || "Choose a CSV file"}</span>
        <span className="text-xs text-[var(--muted)]">
          Shiprocket checkout dashboard → Orders → <strong>Download All</strong>
        </span>
        <input type="file" accept=".csv,text/csv" className="hidden"
          onChange={event => pick(event.target.files?.[0])} />
      </label>

      {error && <Notice tone="error">{error}</Notice>}

      {preview && <>
        <Card className="grid grid-cols-3 gap-4 p-4 text-center">
          <div><p className="text-xs text-[var(--muted)]">Rows</p><p className="text-lg font-semibold">{preview.rows}</p></div>
          <div><p className="text-xs text-[var(--muted)]">With a coupon</p><p className="text-lg font-semibold">{preview.usable}</p></div>
          <div>
            <p className="text-xs text-[var(--muted)]">Will import</p>
            <p className="text-lg font-semibold text-[var(--ok-ink)]">{preview.attributable}</p>
          </div>
        </Card>

        {preview.unknownCoupons.length > 0 && (
          <Notice tone="warning">
            <span className="flex items-start gap-1.5">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <span>
                {preview.unknownCoupons.join(", ")} {preview.unknownCoupons.length === 1 ? "belongs" : "belong"} to no rep here,
                so {preview.unknownCoupons.length === 1 ? "that order is" : "those orders are"} not being imported.
                Add the rep with that code first, then import again.
              </span>
            </span>
          </Notice>
        )}

        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Columns read</p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(preview.mapping).map(([field, header]) => (
              <Badge key={field}>{field} ← {header}</Badge>
            ))}
          </div>
        </div>

        {preview.skipped.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Rows not imported</p>
            <ul className="space-y-0.5 text-xs text-[var(--muted)]">
              {preview.skipped.map(entry => <li key={entry.reason}>{entry.count} × {entry.reason}</li>)}
            </ul>
          </div>
        )}

        {preview.sample.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
              First {preview.sample.length} — check these before importing
            </p>
            <div className="divide-y divide-[var(--line)] rounded-[10px] border border-[var(--line)]">
              {preview.sample.map(order => (
                <div key={order.name} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{order.name} · {order.couponCode}</p>
                    <p className="text-xs text-[var(--muted)]">
                      {order.rep} · {formatDate(order.placedAt)} · {order.delivery}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm tabular-nums">
                    {formatRupees(order.total)}
                    {order.discount > 0 && <span className="text-[var(--muted)]"> after {formatRupees(order.discount)} off</span>}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </>}
    </div>
  </Modal>;
}
