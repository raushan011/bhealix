"use client";

import { useState } from "react";
import { History, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/kit";
import type { SyncReport } from "@/lib/sales/types";

/**
 * Pulls from Shopify and Shiprocket and says what it did.
 *
 * The report is the whole point. "Synced" tells an operator nothing; "42 orders
 * read since 13 May, 3 new, 12 deliveries updated — and two coupon codes belong
 * to no rep here" tells them whether to go and look at something. A sync that
 * quietly attributes nothing looks identical to one that worked, right up until
 * payout day.
 *
 * `full` exists because the ordinary sync is **incremental**: it asks Shopify
 * for orders touched since the last run. Run it twice in a minute and it
 * correctly reads nothing, which reads exactly like a broken integration to
 * somebody who has just connected. The full pull ignores the last run and
 * reaches back over the whole backfill window.
 */
export function SyncButton({ onDone, tone = "primary", label = "Sync now", full = false, sinceDays = 90 }: {
  onDone?: (report: SyncReport & { message: string }) => void;
  tone?: "primary" | "secondary";
  label?: string;
  full?: boolean;
  sinceDays?: number;
}) {
  const [busy, setBusy] = useState(false);

  async function sync() {
    setBusy(true);
    try {
      const response = await fetch("/api/sales/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target: "all", ...(full ? { sinceDays } : {}) })
      });
      const json = await response.json() as { error?: string; data?: SyncReport };
      if (!response.ok || !json.data) throw new Error(json.error ?? "Could not sync");

      const report = json.data;
      const since = report.ordersSince
        ? ` since ${new Date(report.ordersSince).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
        : "";

      const parts = [
        `${report.ordersSeen} order${report.ordersSeen === 1 ? "" : "s"} read${since}`,
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
    {full ? <History size={16} /> : <RefreshCw size={16} />}
    {busy ? "Syncing…" : label}
  </Button>;
}
