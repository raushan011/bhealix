"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { Badge, Button, Notice, Spinner } from "@/components/ui/kit";
import { Modal } from "@/components/ui/modal";
import { formatDateTime } from "@/lib/time";
import { deliveryTone } from "@/lib/sales/delivery";
import type { DeliveryState } from "@/lib/sales/constants";
import type { SalesOrderRecord } from "@/lib/sales/types";

/**
 * Where the parcel actually is, scan by scan.
 *
 * The row already carries a delivery state, which is the right shape for
 * scanning fifty of them for the one that has gone wrong. It is the wrong shape
 * for the question this answers, which is always asked about **one** order and
 * usually with a customer on the telephone: *where is it, when was it last
 * seen, and what do I tell them.* That wants the courier's own movement history
 * and a link the customer can be given, not a badge.
 *
 * Opening it re-reads the courier — so the state on the screen behind updates
 * too, rather than waiting for the nightly sync to agree with what the operator
 * can plainly see here.
 */

type Scan = { at?: string; activity: string; location?: string };
type Tracking = {
  awb: string;
  courier?: string;
  status?: string;
  trackUrl?: string;
  scans: Scan[];
  note?: string;
};

export function TrackDialog({ order, onClose, onRefreshed }: {
  order: SalesOrderRecord;
  onClose: () => void;
  /** The delivery state may have moved on; the list behind wants to know. */
  onRefreshed?: () => void;
}) {
  const [tracking, setTracking] = useState<Tracking | null>(null);
  const [delivery, setDelivery] = useState<DeliveryState>(order.delivery.state);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/sales/orders/${order._id}/track`);
      const json = await response.json() as {
        data?: { tracking: Tracking; delivery: { state: DeliveryState } };
        error?: string;
      };
      if (!response.ok) throw new Error(json.error ?? "Could not reach the courier.");
      setTracking(json.data?.tracking ?? null);
      if (json.data?.delivery.state) setDelivery(json.data.delivery.state);
      onRefreshed?.();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not reach the courier.");
    } finally {
      setLoading(false);
    }
  }, [order._id, onRefreshed]);

  useEffect(() => { load(); }, [load]);

  return <Modal title={`Track ${order.name}`}
    description={[order.shipment?.courier, order.shipment?.awb ? `AWB ${order.shipment.awb}` : ""].filter(Boolean).join(" · ")}
    onClose={onClose}
    footer={<div className="flex gap-2">
      <Button tone="secondary" className="flex-1" busy={loading} onClick={load}><RefreshCw size={16} />Refresh</Button>
      <Button className="flex-1" onClick={onClose}>Close</Button>
    </div>}>

    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={deliveryTone(delivery)}>{delivery}</Badge>
        {tracking?.status && <span className="text-sm text-[var(--muted)]">{tracking.status}</span>}
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {tracking?.note && <Notice tone="info">{tracking.note}</Notice>}

      {loading && !tracking ? <Spinner label="Asking the courier…" /> : tracking?.scans.length ? (
        <ol className="space-y-3">
          {tracking.scans.map((scan, at) => (
            <li key={`${scan.at}-${at}`} className="flex gap-3">
              {/* Newest first, and the newest one is the answer — so it is the
                  only one drawn in the brand colour. */}
              <span className={`mt-1.5 size-2 shrink-0 rounded-full ${at === 0 ? "bg-[var(--brand)]" : "bg-[var(--line-2)]"}`} />
              <div className="min-w-0 flex-1 border-b border-[var(--line)] pb-3">
                <p className="text-sm font-medium">{scan.activity}</p>
                <p className="text-xs text-[var(--muted)]">
                  {scan.at ? formatDateTime(scan.at) : ""}{scan.location ? ` · ${scan.location}` : ""}
                </p>
              </div>
            </li>
          ))}
        </ol>
      ) : null}

      {tracking?.trackUrl && (
        /* The page a customer can be given. Opened rather than embedded — it is
           the courier's own, and it is the one thing on this screen that is
           meant to leave it. */
        <a href={tracking.trackUrl} target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm font-medium text-[var(--brand)] hover:underline">
          <ExternalLink size={14} />Open the courier&rsquo;s tracking page
        </a>
      )}
    </div>
  </Modal>;
}
