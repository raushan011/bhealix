"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { BadgeIndianRupee, Wallet } from "lucide-react";
import { Badge, Button, Card, EmptyState, Notice, Spinner, Stat } from "@/components/ui/kit";
import { describeRule, formatRupees, INCENTIVE_STATUSES, incentiveTone, PAYMENT_MODE_LABEL, type IncentiveRule } from "@/lib/sales-team/orders";
import type { ExecutiveSummary } from "@/lib/sales-team/server";
import { formatDate } from "@/lib/time";
import { call, executiveNameOf, messageOf, paymentLine, PayIncentiveModal, type TeamOrderRow } from "./shared";

type Payload = {
  items: TeamOrderRow[];
  summaries: ExecutiveSummary[];
  totals: { incentive: { pending: number; payable: number; paid: number; earned: number } };
  mayPay: boolean;
};

/**
 * Incentives, order by order.
 *
 * For the administrator it is the payment desk: tick the delivered orders, say
 * how the money went, and they are marked paid in one conditional write. For an
 * executive it is their own statement — what is on the way, what is owed, what
 * has been paid and when — with the rules they are paid by written above it.
 */
export function IncentiveBoard({ admin, orderPath }: { admin: boolean; orderPath: string }) {
  const params = useSearchParams();
  const [status, setStatus] = useState(params.get("status") ?? (admin ? "Payable" : ""));
  const [executive, setExecutive] = useState(params.get("executive") ?? "");
  const [data, setData] = useState<Payload | null>(null);
  const [rules, setRules] = useState<IncentiveRule[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [paying, setPaying] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    const query = new URLSearchParams();
    if (status) query.set("status", status);
    if (executive) query.set("executive", executive);
    try {
      setData(await call<Payload>(`/api/sales-team/incentives?${query}`));
      setSelected(new Set());
    } catch (problem) {
      setNotice({ tone: "error", text: messageOf(problem) });
    }
  }, [status, executive]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { call<{ incentiveRules: IncentiveRule[] }>("/api/sales-team/settings").then(result => setRules(result.incentiveRules)).catch(() => undefined); }, []);

  const payable = useMemo(() => (data?.items ?? []).filter(order => order.incentive.status === "Payable"), [data]);
  const chosen = payable.filter(order => selected.has(order._id));
  const toggle = (id: string) => setSelected(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  if (!data) return notice ? <Notice tone="error">{notice.text}</Notice> : <Spinner label="Loading incentives…" />;

  return <div className="space-y-5">
    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

    <Card className="grid grid-cols-2 gap-5 p-5 sm:grid-cols-4">
      <Stat label="On the way" value={formatRupees(data.totals.incentive.pending)} tone="text-[var(--warn-ink)]" />
      <Stat label="Owed now" value={formatRupees(data.totals.incentive.payable)} />
      <Stat label="Paid" value={formatRupees(data.totals.incentive.paid)} tone="text-[var(--ok-ink)]" />
      <Stat label="Earned (owed + paid)" value={formatRupees(data.totals.incentive.earned)} />
    </Card>

    {rules.length > 0 && (
      <Card className="flex flex-wrap gap-x-6 gap-y-2 p-4 text-sm">
        <span className="font-semibold">How incentives are worked out</span>
        {rules.map(rule => <span key={rule.mode} className="text-[var(--ink-2)]">{PAYMENT_MODE_LABEL[rule.mode]}: {describeRule(rule)}</span>)}
        <span className="basis-full text-xs text-[var(--muted)]">Earned when the parcel is delivered. Each order keeps the rule it was placed under.</span>
      </Card>
    )}

    {admin && data.summaries.length > 0 && (
      <Card className="divide-y divide-[var(--line)]">
        {data.summaries.map(row => (
          <button key={row.executive._id} onClick={() => setExecutive(executive === row.executive._id ? "" : row.executive._id)}
            className={`flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left sm:px-5 ${executive === row.executive._id ? "bg-[var(--brand-soft)]" : "hover:bg-[var(--surface-2)]"}`}>
            <span className="min-w-0 flex-1 text-sm font-semibold">{row.executive.name}{!row.executive.active && <span className="ml-2 text-xs font-normal text-[var(--muted)]">inactive</span>}</span>
            <span className="text-xs text-[var(--muted)]">{row.delivered} delivered of {row.orders}</span>
            <span className="w-24 text-right text-xs tabular-nums text-[var(--warn-ink)]">{formatRupees(row.incentive.pending)} pending</span>
            <span className="w-24 text-right text-sm font-semibold tabular-nums">{formatRupees(row.incentive.payable)} owed</span>
            <span className="w-24 text-right text-xs tabular-nums text-[var(--ok-ink)]">{formatRupees(row.incentive.paid)} paid</span>
          </button>
        ))}
      </Card>
    )}

    <div className="flex flex-wrap items-center gap-2">
      {["", ...INCENTIVE_STATUSES].map(value => (
        <button key={value || "all"} onClick={() => setStatus(value)}
          className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${status === value ? "border-[var(--brand)] bg-[var(--brand)] text-[var(--on-brand)]" : "border-[var(--line-2)] text-[var(--ink-2)] hover:bg-[var(--surface-2)]"}`}>
          {value || "All"}
        </button>
      ))}
      {data.mayPay && payable.length > 0 && (
        <div className="ml-auto flex items-center gap-2">
          <button className="text-xs font-semibold text-[var(--brand)]" onClick={() => setSelected(new Set(chosen.length === payable.length ? [] : payable.map(order => order._id)))}>
            {chosen.length === payable.length ? "Clear" : "Select all owed"}
          </button>
          <Button disabled={!chosen.length} onClick={() => setPaying(true)}>
            <Wallet size={16} />Pay {chosen.length ? formatRupees(chosen.reduce((sum, order) => sum + order.incentive.amount, 0)) : ""}
          </Button>
        </div>
      )}
    </div>

    {!data.items.length ? (
      <EmptyState icon={BadgeIndianRupee} title="Nothing here" description={status ? `No ${status.toLowerCase()} incentives.` : "No orders yet."} />
    ) : (
      <Card className="divide-y divide-[var(--line)]">
        {data.items.map(order => (
          <div key={order._id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
            {data.mayPay && (
              <input type="checkbox" className="mt-1" aria-label={`Select ${order.name}`} disabled={order.incentive.status !== "Payable"}
                checked={selected.has(order._id)} onChange={() => toggle(order._id)} />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`${orderPath}/${order._id}`} className="text-sm font-semibold hover:underline">{order.name}</Link>
                <Badge tone={incentiveTone(order.incentive.status)}>{order.incentive.status}</Badge>
                {order.incentive.needsReversal && <Badge tone="danger">Needs recovery</Badge>}
              </div>
              <p className="mt-0.5 text-xs text-[var(--muted)]">
                {formatDate(order.placedAt)}{admin ? ` · ${executiveNameOf(order)}` : ""} · {order.customer?.name} · {PAYMENT_MODE_LABEL[order.paymentMode]} · {order.delivery.state}
              </p>
              {order.incentive.status === "Paid" && order.incentive.payment
                ? <p className="mt-0.5 text-xs text-[var(--ok-ink)]">Paid {paymentLine(order.incentive.payment)}</p>
                : order.incentive.reason && <p className="mt-0.5 text-xs text-[var(--muted)]">{order.incentive.reason}</p>}
            </div>
            <div className="shrink-0 text-right">
              <p className="text-sm font-semibold tabular-nums">{formatRupees(order.incentive.amount)}</p>
              <p className="text-xs text-[var(--muted)]">on {formatRupees(order.totals.paid)}</p>
            </div>
          </div>
        ))}
      </Card>
    )}

    {paying && <PayIncentiveModal
      orders={chosen.map(order => ({ _id: order._id, name: order.name, amount: order.incentive.amount, executive: executiveNameOf(order) }))}
      onClose={() => setPaying(false)}
      onPaid={text => { setPaying(false); setNotice({ tone: "success", text }); load(); }} />}
  </div>;
}
