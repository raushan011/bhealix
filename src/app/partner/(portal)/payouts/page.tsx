"use client";

import { useCallback, useEffect, useState } from "react";
import { Wallet } from "lucide-react";
import { Badge, Card, EmptyState, Notice, PageTitle, Spinner, Stat } from "@/components/ui/kit";
import { formatDate } from "@/lib/time";
import { formatRupees } from "@/lib/sales/types";

type Line = {
  _id: string;
  run?: { payoutNo?: string; from?: string; to?: string; status?: string; paidAt?: string; paymentDate?: string; paymentMode?: string; reference?: string } | null;
  orders: { order: string; name?: string; placedAt?: string; base: number; rate: number; amount: number }[];
  orderCount: number;
  gross: number;
  adjustments: { name: string; amount: number }[];
  net: number;
  note?: string;
};

type Payload = { lines: Line[]; totals: { paid: number; onTheWay: number } };

/**
 * What the rep has been paid, and what each payment was made of.
 *
 * Every line lists the orders behind it as they stood on the day the run was
 * generated — which is the point of the whole screen. "₹1,800 paid in August" is
 * a figure to be suspicious of; "₹1,800, being these four orders at these
 * rates" is a receipt.
 *
 * Draft runs never appear. The server declines to send them, and the reason is
 * worth repeating here: a draft can still change, and a number that goes down
 * after a rep has seen it costs more trust than the early sight was worth.
 */
export default function PartnerPayoutsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const response = await fetch("/api/partner/payouts");
    const json = await response.json() as { data?: Payload };
    setData(json.data ?? null);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <Spinner label="Loading your payments…" />;
  if (!data) return <Notice tone="error">Could not load your payments.</Notice>;

  return <div className="space-y-5">
    <PageTitle title="Payments" subtitle="What you have been paid, and what each payment was made of" />

    <Card className="grid grid-cols-2 gap-5 p-5">
      <Stat label="Paid to you" value={formatRupees(data.totals.paid)} />
      <Stat label="Approved, on its way" value={formatRupees(data.totals.onTheWay)}
        tone={data.totals.onTheWay ? "text-[var(--ok-ink)]" : undefined} />
    </Card>

    {data.lines.length ? (
      <div className="space-y-4">
        {data.lines.map(line => {
          const paid = line.run?.status === "Paid";
          return <Card key={line._id} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold">{line.run?.payoutNo ?? "Payment"}</p>
                  <Badge tone={paid ? "success" : "info"}>{paid ? "Paid" : "Approved"}</Badge>
                </div>
                <p className="mt-0.5 text-xs text-[var(--muted)]">
                  {line.run?.from && line.run?.to ? `${formatDate(line.run.from)} – ${formatDate(line.run.to)}` : ""}
                  {` · ${line.orderCount} order${line.orderCount === 1 ? "" : "s"}`}
                </p>
                {paid && (
                  <p className="mt-0.5 text-xs text-[var(--muted)]">
                    {[
                      line.run?.paymentDate ? `Paid ${formatDate(line.run.paymentDate)}` : line.run?.paidAt ? `Paid ${formatDate(line.run.paidAt)}` : null,
                      line.run?.paymentMode,
                      line.run?.reference
                    ].filter(Boolean).join(" · ")}
                  </p>
                )}
              </div>
              <p className="shrink-0 text-lg font-semibold tabular-nums">{formatRupees(line.net)}</p>
            </div>

            {line.orders.length > 0 && (
              <ul className="mt-4 space-y-1.5 border-t border-[var(--line)] pt-3">
                {line.orders.map(order => (
                  <li key={order.order} className="flex justify-between gap-3 text-xs">
                    <span className="min-w-0 truncate text-[var(--muted)]">
                      {order.name ?? "Order"}{order.placedAt ? ` · ${formatDate(order.placedAt)}` : ""} · {order.rate}% of {formatRupees(order.base)}
                    </span>
                    <span className="shrink-0 tabular-nums text-[var(--ink-2)]">{formatRupees(order.amount)}</span>
                  </li>
                ))}
              </ul>
            )}

            {/*
              * Adjustments are shown in full, including the negative ones. A
              * recovery netted quietly off the total is the fastest way to make
              * somebody distrust every other figure on the page.
              */}
            {line.adjustments.length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-[var(--line)] pt-3">
                {line.adjustments.map((adjustment, at) => (
                  <li key={`${adjustment.name}-${at}`} className="flex justify-between gap-3 text-xs">
                    <span className="min-w-0 wrap-break-word text-[var(--muted)]">{adjustment.name}</span>
                    <span className={`shrink-0 tabular-nums ${adjustment.amount < 0 ? "text-[var(--danger-ink)]" : "text-[var(--ink-2)]"}`}>
                      {adjustment.amount < 0 ? "−" : "+"}{formatRupees(Math.abs(adjustment.amount))}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {line.note && <p className="mt-3 text-xs text-[var(--muted)]">{line.note}</p>}
          </Card>;
        })}
      </div>
    ) : (
      <EmptyState icon={Wallet} title="No payments yet"
        description="Payments appear here once a run covering your orders has been approved. Until then, what you have earned is shown on the home screen." />
    )}
  </div>;
}
