"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { QrCode, Trash2, Upload } from "lucide-react";
import { Button, Notice } from "@/components/ui/kit";
import { formatBytes, MAX_QR_BYTES, QR_TYPES, sizeLimitText } from "@/lib/billing/attachments";

const ACCEPTED: readonly string[] = QR_TYPES;

/**
 * The payment QR, uploaded once and printed on every bill afterwards.
 *
 * Sent on its own rather than with the rest of the billing settings: an image
 * is multipart and the settings beside it are JSON, and an administrator who
 * uploads a code should see it appear without having to remember to press Save.
 *
 * The preview is fetched from the server rather than shown from the chosen
 * file, so what is on screen is what a doctor will actually be handed.
 */
export function PaymentQr({ initialType, initialBytes, initialUpdatedAt }: {
  initialType?: string;
  initialBytes?: number;
  initialUpdatedAt?: string;
}) {
  const [held, setHeld] = useState(
    initialType ? { bytes: initialBytes ?? 0, updatedAt: initialUpdatedAt ?? "" } : null
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);

  // The stamp changes with every upload, which is what gets the browser to drop
  // the code it cached for an hour and fetch the new one.
  const source = `/api/billing/settings/qr?v=${encodeURIComponent(held?.updatedAt ?? "")}`;

  async function upload(file: File | undefined) {
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) { setError("The QR must be a JPEG, PNG or WebP image"); return; }
    if (file.size > MAX_QR_BYTES) { setError(`The QR image must be ${sizeLimitText(MAX_QR_BYTES)}`); return; }

    setBusy(true); setError("");
    try {
      const body = new FormData();
      body.append("qr", file, file.name);
      const response = await fetch("/api/billing/settings/qr", { method: "POST", body });
      const json = await response.json() as { error?: string; data?: { paymentQrBytes: number; paymentQrUpdatedAt: string } };
      if (!response.ok) throw new Error(json.error ?? "Could not upload that QR");
      setHeld({ bytes: json.data?.paymentQrBytes ?? file.size, updatedAt: json.data?.paymentQrUpdatedAt ?? String(Date.now()) });
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not upload that QR");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function remove() {
    if (!window.confirm("Remove the payment QR? Bills printed after this will not carry it.")) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/billing/settings/qr", { method: "DELETE" });
      const json = await response.json() as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "Could not remove the QR");
      setHeld(null);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not remove the QR");
    } finally { setBusy(false); }
  }

  return <div className="space-y-3">
    <div>
      <p className="text-[13px] font-medium text-[var(--ink-2)]">Payment QR</p>
      <p className="mt-1 text-xs text-[var(--muted)]">
        Saved out of your UPI or banking app and printed on every bill, so a doctor can scan and pay on the spot.
      </p>
    </div>

    <div className="flex flex-wrap items-start gap-4">
      <div className="grid size-[128px] shrink-0 place-items-center overflow-hidden rounded-[10px] border border-dashed border-[var(--line-2)] bg-[var(--surface-2)]">
        {held ? (
          // Unoptimized: these bytes sit behind the session, and running them
          // through the image optimiser would leave a copy of them cached
          // somewhere with a lifetime of its own.
          <Image src={source} alt="The payment QR printed on your bills"
            width={128} height={128} unoptimized className="size-full object-contain" />
        ) : (
          <QrCode size={26} className="text-[var(--line-2)]" />
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap gap-2">
          <Button tone="secondary" busy={busy} onClick={() => input.current?.click()} className="!min-h-10 !px-3 text-xs">
            <Upload size={14} />{held ? "Replace" : "Upload QR"}
          </Button>
          {held && (
            <Button tone="danger" busy={busy} onClick={remove} className="!min-h-10 !px-3 text-xs">
              <Trash2 size={14} />Remove
            </Button>
          )}
        </div>
        <p className="text-xs text-[var(--muted)]">
          {held
            ? `${formatBytes(held.bytes)}${held.updatedAt ? ` · uploaded ${new Date(held.updatedAt).toLocaleDateString("en-IN")}` : ""}`
            : `JPEG, PNG or WebP, ${sizeLimitText(MAX_QR_BYTES)}.`}
        </p>
      </div>
    </div>

    <input ref={input} type="file" accept={ACCEPTED.join(",")} className="hidden"
      onChange={event => upload(event.target.files?.[0])} />

    {error && <Notice tone="error">{error}</Notice>}
  </div>;
}
