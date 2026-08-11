"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/kit";
import type { SyncReport } from "@/lib/sales/types";

/**
 * Pulls from Shopify and Shiprocket and says what it did.
 *
 * The report is the whole point. "Synced" tells an operator nothing; "42 orders,
 * 3 new, 12 deliveries updated — and two coupon codes belong to no rep here"
 * tells them whether to go and look at something. A sync that quietly attributes
 * nothing looks identical to a sync that worked, right up until payout day.
 */
export function SyncButton({ onDone, tone = "primary", label = "Sync now" }: {
  onDone?: (report: SyncReport & { message: string }) => void;
  tone?: "primary" | "secondary";
  label?: string;
}) {
  const [busy, setBusy] = useState(false);

  async function sync() {
    setBusy(true);
    try {
      const response = await fetch("/api/sales/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target: "all" })
      });
      const json = await response.json() as { error?: string; data?: SyncReport };
      if (!response.ok || !json.data) throw new Error(json.error ?? "Could not sync");

      const report = json.data;
      const parts = [
        `${report.ordersSeen} order${report.ordersSeen === 1 ? "" : "s"} read`,
        `${report.ordersAttributed} attributed`,
        report.ordersCreated ? `${report.ordersCreated} new` : "",
        report.shipmentsMatched ? `${report.shipmentsMatched} delivery update${report.shipmentsMatched === 1 ? "" : "s"}` : ""
      ].filter(Boolean);

      onDone?.({ ...report, message: parts.join(" · ") });
    } catch (problem) {
      onDone?.({
        ordersSeen: 0, ordersAttributed: 0, ordersSkipped: 0, ordersCreated: 0, ordersUpdated: 0,
        shipmentsMatched: 0, shipmentsUnmatched: 0, commissionsRecalculated: 0,
        unknownCoupons: [], warnings: [problem instanceof Error ? problem.message : "Could not sync"],
        message: ""
      });
    } finally {
      setBusy(false);
    }
  }

  return <Button tone={tone} busy={busy} onClick={sync}>
    <RefreshCw size={16} />{busy ? "Syncing…" : label}
  </Button>;
}
