"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, Zap } from "lucide-react";
import { Badge, Card, Notice } from "@/components/ui/kit";

type Run = {
  _id: string;
  trigger: "Manual" | "Scheduled" | "Webhook";
  target: string;
  finishedAt: string;
  durationMs?: number;
  ordersSeen: number;
  ordersAttributed: number;
  ordersCreated: number;
  ordersUpdated: number;
  shipmentsMatched: number;
  warnings: string[];
  error?: string;
  actor?: { name?: string } | null;
};

/**
 * Whether the automation is actually running.
 *
 * "It syncs every night" is a claim until there is a list of nights it synced
 * on. Without this the first anybody learns that the schedule stopped is a
 * payout run that comes back empty — and by then a week of commissions is
 * missing with nothing to point at.
 */
export function AutomationPanel() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [scheduled, setScheduled] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const response = await fetch("/api/sales/sync");
    const json = await response.json() as { data?: { runs: Run[]; scheduled: boolean } };
    setRuns(json.data?.runs ?? []);
    setScheduled(Boolean(json.data?.scheduled));
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const lastScheduled = runs.find(run => run.trigger === "Scheduled");
  const stale = lastScheduled && Date.now() - new Date(lastScheduled.finishedAt).getTime() > 36 * 3_600_000;

  return <Card className="space-y-4 p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-base font-semibold">Automation</h2>
      {scheduled
        ? <Badge tone="success">Nightly sync on</Badge>
        : <Badge tone="warn">Nightly sync off</Badge>}
    </div>

    <div className="grid gap-3 sm:grid-cols-2">
      <div className="flex items-start gap-2 text-sm">
        <Zap size={15} className="mt-0.5 shrink-0 text-[var(--muted)]" />
        <span>
          <strong>As they happen.</strong> Shopify tells this CRM the moment an order is placed,
          changed or cancelled. Set up when you connect.
        </span>
      </div>
      <div className="flex items-start gap-2 text-sm">
        <Clock size={15} className="mt-0.5 shrink-0 text-[var(--muted)]" />
        <span>
          <strong>Every night at 01:30.</strong> Pulls anything a live update missed, asks Shiprocket
          about every parcel still moving, and clears the commissions whose hold has elapsed.
        </span>
      </div>
    </div>

    {!scheduled && (
      <Notice tone="warning">
        The nightly pass is not switched on: set <code>CRON_SECRET</code> in the hosting environment to any long random
        string. Without it, commissions still mature correctly — a payout run reads the maturity date rather than a
        stored status — but these screens will only be as current as the last time somebody pressed Sync.
      </Notice>
    )}

    {stale && (
      <Notice tone="error">
        The last scheduled pass was more than a day and a half ago. Something is stopping the schedule.
      </Notice>
    )}

    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Recent passes</p>
      {loading ? (
        <p className="text-sm text-[var(--muted)]">Loading…</p>
      ) : runs.length ? (
        <div className="divide-y divide-[var(--line)] rounded-[10px] border border-[var(--line)]">
          {runs.map(run => (
            <div key={run._id} className="flex flex-wrap items-start gap-3 px-3 py-2.5">
              {run.error
                ? <AlertTriangle size={15} className="mt-0.5 shrink-0 text-[var(--danger-ink)]" />
                : <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-[var(--ok-ink)]" />}

              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  {new Date(run.finishedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  <span className="text-[var(--muted)]">
                    {" · "}{run.trigger === "Manual" ? `by ${run.actor?.name ?? "hand"}` : run.trigger.toLowerCase()}
                  </span>
                </p>
                {run.error ? (
                  <p className="text-xs text-[var(--danger-ink)]">{run.error}</p>
                ) : (
                  <p className="text-xs text-[var(--muted)]">
                    {run.ordersSeen} read · {run.ordersAttributed} attributed
                    {run.ordersCreated ? ` · ${run.ordersCreated} new` : ""}
                    {run.shipmentsMatched ? ` · ${run.shipmentsMatched} delivery updates` : ""}
                  </p>
                )}
                {run.warnings?.map(warning => (
                  <p key={warning} className="mt-0.5 text-xs text-[var(--warn-ink)]">{warning}</p>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-[var(--muted)]">Nothing has run yet.</p>
      )}
    </div>
  </Card>;
}
