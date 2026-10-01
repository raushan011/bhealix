"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw, TrendingUp, UserPlus } from "lucide-react";
import { Button, Card, EmptyState, Notice, Spinner, Stat } from "@/components/ui/kit";
import { describeRule, formatRupees, PAYMENT_MODE_LABEL, type IncentiveRule } from "@/lib/sales-team/orders";
import type { ExecutiveSummary } from "@/lib/sales-team/server";
import { formatDateTime, shiftDay, todayIso } from "@/lib/time";
import { call, messageOf } from "./shared";

type Row = ExecutiveSummary & { leads: { assigned: number; converted: number; fresh: number; interested: number } };
type Payload = {
  from: string; to: string;
  totals: { orders: number; booked: number; delivered: number; returned: number; cancelled: number; revenue: number; deliveredRevenue: number; incentive: { pending: number; payable: number; paid: number; earned: number } };
  executives: Row[];
  unassignedLeads?: number;
  rules: IncentiveRule[];
  lastSync: string | null;
  lastSyncError: string | null;
};

const RANGES = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "This year", days: 365 }
];

const percent = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "—");

/**
 * How the sales team is doing, executive by executive: orders placed, how many
 * reached the customer and how many came back, revenue, and what each has
 * earned — owed and paid. `admin` is the desk's view of everybody; without it,
 * the same figures for the one executive signed in.
 */
export function TeamOverview({ admin, orderPath, incentivePath }: { admin: boolean; orderPath: string; incentivePath: string }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Payload | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    const to = todayIso();
    try { setData(await call<Payload>(`/api/sales-team/overview?from=${shiftDay(to, -(days - 1))}&to=${to}`)); } catch (problem) { setNotice({ tone: "error", text: messageOf(problem) }); }
  }, [days]);
  useEffect(() => { load(); }, [load]);

  async function sync() {
    setSyncing(true); setNotice(null);
    try {
      const report = await call<{ matched: number; updated: number }>("/api/sales-team/sync", { method: "POST" });
      setNotice({ tone: "success", text: `Delivery status refreshed — ${report.matched} parcel${report.matched === 1 ? "" : "s"} checked, ${report.updated} changed.` });
      await load();
    } catch (problem) { setNotice({ tone: "error", text: messageOf(problem) }); } finally { setSyncing(false); }
  }

  if (!data) return notice ? <Notice tone="error">{notice.text}</Notice> : <Spinner label="Loading the sales team…" />;
  const { totals } = data;
  const settled = totals.delivered + totals.returned;

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center gap-2">
      {RANGES.map(range => (
        <button key={range.days} onClick={() => setDays(range.days)}
          className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${days === range.days ? "border-[var(--brand)] bg-[var(--brand)] text-[var(--on-brand)]" : "border-[var(--line-2)] text-[var(--ink-2)] hover:bg-[var(--surface-2)]"}`}>
          {range.label}
        </button>
      ))}
      {admin && <Button tone="secondary" className="ml-auto !min-h-[36px] text-xs" busy={syncing} onClick={sync}><RefreshCw size={14} />Refresh delivery status</Button>}
    </div>

    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
    {admin && data.lastSyncError && <Notice tone="error">The last delivery refresh failed: {data.lastSyncError}</Notice>}

    <Card className="grid grid-cols-2 gap-5 p-5 sm:grid-cols-4">
      <Stat label="Orders placed" value={totals.orders} />
      <Stat label="Delivered" value={totals.delivered} tone="text-[var(--ok-ink)]" />
      <Stat label="Delivery rate" value={percent(totals.delivered, settled)} />
      <Stat label="Revenue" value={formatRupees(totals.revenue)} />
    </Card>
    <Card className="grid grid-cols-2 gap-5 p-5 sm:grid-cols-4">
      <Stat label="Incentive on the way" value={formatRupees(totals.incentive.pending)} tone="text-[var(--warn-ink)]" />
      <Stat label="Incentive owed" value={formatRupees(totals.incentive.payable)} />
      <Stat label="Incentive paid" value={formatRupees(totals.incentive.paid)} tone="text-[var(--ok-ink)]" />
      <Stat label="Returned / cancelled" value={`${totals.returned} / ${totals.cancelled}`} tone={totals.returned ? "text-[var(--danger-ink)]" : undefined} />
    </Card>

    {admin && Boolean(data.unassignedLeads) && (
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <p className="text-sm"><strong>{data.unassignedLeads}</strong> open lead{data.unassignedLeads === 1 ? " is" : "s are"} not with anybody yet.</p>
        <Link href="/admin/sales/leads" className="tap inline-flex items-center gap-2 rounded-[10px] bg-[var(--brand)] px-4 text-sm font-semibold text-[var(--on-brand)]"><UserPlus size={16} />Hand them out</Link>
      </Card>
    )}

    <div>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-base font-semibold">{admin ? "Executives" : "Your numbers"}</h2>
        {data.lastSync && <span className="text-xs text-[var(--muted)]">Delivery status as of {formatDateTime(data.lastSync)}</span>}
      </div>
      {!data.executives.length ? (
        <EmptyState icon={TrendingUp} title="No sales executives yet"
          description="Add your sales team under HR & Employees with the Sales executive role. They sign in with their own login and see only their own leads, orders and incentives."
          action={admin ? <Link href="/admin/team/new?role=EXECUTIVE" className="tap inline-flex items-center rounded-[10px] bg-[var(--brand)] px-4 text-sm font-semibold text-[var(--on-brand)]">Add a sales executive</Link> : undefined} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-[var(--line)] text-left text-xs text-[var(--muted)]">
                <th className="px-4 py-3 font-medium">Executive</th>
                <th className="px-3 py-3 text-right font-medium">Leads</th>
                <th className="px-3 py-3 text-right font-medium">Orders</th>
                <th className="px-3 py-3 text-right font-medium">Delivered</th>
                <th className="px-3 py-3 text-right font-medium">Returned</th>
                <th className="px-3 py-3 text-right font-medium">COD / Prepaid / Part</th>
                <th className="px-3 py-3 text-right font-medium">Revenue</th>
                <th className="px-3 py-3 text-right font-medium">Owed</th>
                <th className="px-4 py-3 text-right font-medium">Paid</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {data.executives.map(row => (
                <tr key={row.executive._id}>
                  <td className="px-4 py-3">
                    <Link href={`${orderPath}${admin ? `?executive=${row.executive._id}` : ""}`} className="font-semibold hover:underline">{row.executive.name}</Link>
                    {!row.executive.active && <span className="ml-2 text-xs text-[var(--muted)]">inactive</span>}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">{row.leads.assigned}<span className="block text-xs text-[var(--muted)]">{row.leads.converted} converted</span></td>
                  <td className="px-3 py-3 text-right tabular-nums">{row.orders}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{row.delivered}<span className="block text-xs text-[var(--muted)]">{percent(row.delivered, row.delivered + row.returned)}</span></td>
                  <td className="px-3 py-3 text-right tabular-nums">{row.returned}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{row.byMode.COD} / {row.byMode.Prepaid} / {row.byMode.Partial}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{formatRupees(row.revenue)}</td>
                  <td className="px-3 py-3 text-right tabular-nums"><Link href={`${incentivePath}?status=Payable${admin ? `&executive=${row.executive._id}` : ""}`} className="hover:underline">{formatRupees(row.incentive.payable)}</Link></td>
                  <td className="px-4 py-3 text-right tabular-nums text-[var(--ok-ink)]">{formatRupees(row.incentive.paid)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>

    <Card className="flex flex-wrap gap-x-6 gap-y-1 p-4 text-sm">
      <span className="font-semibold">Incentive rules</span>
      {data.rules.map(rule => <span key={rule.mode} className="text-[var(--ink-2)]">{PAYMENT_MODE_LABEL[rule.mode]}: {describeRule(rule)}</span>)}
      {admin && <Link href="/admin/sales/settings" className="text-[var(--brand)] hover:underline">Change</Link>}
    </Card>
  </div>;
}
