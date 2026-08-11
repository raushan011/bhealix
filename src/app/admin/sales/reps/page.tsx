"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { UserPlus, Users } from "lucide-react";
import { Badge, Button, Card, EmptyState, Notice, PageTitle, Spinner, Stat } from "@/components/ui/kit";
import { RepForm } from "@/components/sales/rep-form";
import { formatRupees, type RepSummary, type SalesRepRecord } from "@/lib/sales/types";

/**
 * The sales team, with what each of them has actually brought in.
 *
 * Sorted by what is payable rather than alphabetically: the list is read on
 * payout day, and the person owed the most is the one worth checking first.
 */
export default function SalesRepsPage() {
  const [reps, setReps] = useState<SalesRepRecord[]>([]);
  const [summaries, setSummaries] = useState<RepSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/sales/reps");
    const json = await response.json() as { data?: { reps: SalesRepRecord[]; summaries: RepSummary[] } };
    setReps(json.data?.reps ?? []);
    setSummaries(json.data?.summaries ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <Spinner label="Loading the sales team…" />;

  const byId = new Map(summaries.map(summary => [summary.rep._id, summary]));
  const ordered = [...reps].sort((a, b) => {
    const left = byId.get(String(a._id)), right = byId.get(String(b._id));
    return (right?.payable ?? 0) - (left?.payable ?? 0) || (right?.revenue ?? 0) - (left?.revenue ?? 0);
  });

  const totals = summaries.reduce(
    (running, summary) => ({
      orders: running.orders + summary.orders,
      revenue: running.revenue + summary.revenue,
      payable: running.payable + summary.payable,
      paid: running.paid + summary.paid
    }),
    { orders: 0, revenue: 0, payable: 0, paid: 0 }
  );

  return <div className="space-y-5">
    <PageTitle title="Sales team" subtitle="Affiliates selling on commission, and what each has earned"
      actions={<Button onClick={() => setAdding(true)}><UserPlus size={16} />Add rep</Button>} />

    {notice && <Notice tone="success">{notice}</Notice>}

    {reps.length > 0 && (
      <Card className="grid grid-cols-2 gap-5 p-5 lg:grid-cols-4">
        <Stat label="Reps" value={reps.filter(rep => rep.active).length} />
        <Stat label="Orders brought in" value={totals.orders} />
        <Stat label="Revenue" value={formatRupees(totals.revenue)} />
        <Stat label="Payable now" value={formatRupees(totals.payable)} tone="text-[var(--ok-ink)]" />
      </Card>
    )}

    {ordered.length ? (
      <Card className="divide-y divide-[var(--line)]">
        {ordered.map(rep => {
          const summary = byId.get(String(rep._id));
          return <Link key={String(rep._id)} href={`/admin/sales/reps/${rep._id}`}
            className="flex flex-wrap items-center gap-4 px-5 py-4 hover:bg-[var(--surface-2)]">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold">{rep.name}</p>
                <Badge>{rep.code}</Badge>
                {!rep.active && <Badge tone="warn">Inactive</Badge>}
              </div>
              <p className="mt-0.5 text-xs text-[var(--muted)]">
                {(rep.coupons ?? []).filter(coupon => coupon.active).map(coupon => coupon.code).join(" · ") || "No coupon codes"}
              </p>
              <p className="mt-0.5 text-xs text-[var(--muted)]">
                {summary?.orders ?? 0} order{summary?.orders === 1 ? "" : "s"} · {summary?.delivered ?? 0} delivered
                {summary?.returned ? ` · ${summary.returned} came back` : ""}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-sm font-semibold">{formatRupees(summary?.payable ?? 0)}</p>
              <p className="text-xs text-[var(--muted)]">payable · {formatRupees(summary?.paid ?? 0)} paid</p>
            </div>
          </Link>;
        })}
      </Card>
    ) : (
      <EmptyState icon={Users} title="No sales reps yet"
        description="A rep is added here with a code — RAUSHAN — and gets a coupon per commission rule. Create the matching discount codes in Shopify so orders can be attributed."
        action={<Button onClick={() => setAdding(true)}><UserPlus size={16} />Add the first rep</Button>} />
    )}

    {adding && <RepForm onClose={() => setAdding(false)} onSaved={message => { setAdding(false); setNotice(message); load(); }} />}
  </div>;
}
