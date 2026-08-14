"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, BadgePercent, Plug, TrendingUp, Users } from "lucide-react";
import { Badge, Card, EmptyState, LinkButton, Notice, PageTitle, Spinner, Stat } from "@/components/ui/kit";
import { SyncButton } from "@/components/sales/sync-button";
import { formatDate } from "@/lib/time";
import { periodLabel } from "@/lib/sales/payouts";
import { formatRupees, type RepSummary, type SyncReport } from "@/lib/sales/types";
import type { SalesOverview } from "@/lib/sales/reporting";

type Overview = SalesOverview & {
  lastPayout?: { _id?: string; to?: string; payoutNo?: string; status?: string } | null;
  nextPayoutDate: string;
  proposedPeriod: { from: string; to: string };
  holdDays: number;
  connected: {
    shopify: boolean;
    shiprocket: boolean;
    lastOrderSyncAt?: string;
    lastShipmentSyncAt?: string;
    lastOrderSyncError?: string;
    lastShipmentSyncError?: string;
  };
};

/**
 * The affiliate operation at a glance.
 *
 * Ordered by what somebody actually comes here to find out, in order: is the
 * data current, is anything wrong, what is owed, and who is selling. The
 * connection state sits at the top because every figure below it is worthless
 * if the last sync failed — and a dashboard of confident zeroes is the worst
 * possible way to find that out.
 */
/**
 * What a sync did, as a line fit for the top of the screen.
 *
 * A warning alongside a result is the interesting case — the pull worked and
 * something in it wants attention, most often a coupon code belonging to
 * nobody. That must not be reported as a failure, and must not be swallowed
 * either.
 */
const noticeFor = (report: SyncReport & { message: string }): { tone: "success" | "warning" | "error"; text: string } =>
  report.warnings.length && !report.message ? { tone: "error", text: report.warnings[0] }
    : report.warnings.length ? { tone: "warning", text: `${report.message}. ${report.warnings.join(" ")}` }
    : { tone: "success", text: report.message };

export default function SalesOverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ tone: "success" | "warning" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/sales/overview");
    const json = await response.json() as { data?: Overview };
    setData(json.data ?? null);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <Spinner label="Loading the sales overview…" />;
  if (!data) return <Notice tone="error">Could not load the sales overview.</Notice>;

  const setUp = data.connected.shopify;
  const syncError = data.connected.lastOrderSyncError || data.connected.lastShipmentSyncError;

  return <div className="space-y-5">
    <PageTitle
      title="Sales CRM"
      subtitle="Partner coupons, delivered orders and what each partner has earned"
      actions={<>
        <LinkButton tone="secondary" href="/admin/sales/payouts"><BadgePercent size={16} />Payouts</LinkButton>
        {/*
          * Two buttons, because the ordinary sync is incremental and reads
          * nothing when nothing has changed — which is indistinguishable from a
          * broken integration to somebody who has just set this up.
          */}
        <SyncButton tone="secondary" full label="Full resync" onDone={report => { setNotice(noticeFor(report)); load(); }} />
        <SyncButton onDone={report => { setNotice(noticeFor(report)); load(); }} />
      </>} />

    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

    {!setUp && (
      <Notice tone="warning">
        Shopify is not connected yet, so no orders are being read.{" "}
        <Link href="/admin/sales/settings" className="underline">Add the credentials</Link> to start pulling orders and delivery status.
      </Notice>
    )}

    {syncError && <Notice tone="error">The last sync failed: {syncError}</Notice>}

    {data.needsAttention > 0 && (
      <Notice tone="warning">
        <span className="inline-flex items-center gap-1.5">
          <AlertTriangle size={15} />
          {data.needsAttention} order{data.needsAttention === 1 ? " has" : "s have"} been promised or paid and then come back.{" "}
          <Link href="/admin/sales/orders?attention=1" className="underline">Review {data.needsAttention === 1 ? "it" : "them"}</Link>.
        </span>
      </Notice>
    )}

    <Card className="grid grid-cols-2 gap-5 p-5 lg:grid-cols-4">
      <Stat label="Orders (30 days)" value={data.orders} />
      <Stat label="Delivered" value={data.delivered} />
      <Stat label="Delivery rate" value={data.deliveryRate === null ? "—" : `${data.deliveryRate}%`}
        tone={data.deliveryRate !== null && data.deliveryRate < 70 ? "text-[var(--danger-ink)]" : undefined} />
      <Stat label="Revenue" value={formatRupees(data.revenue)} />
    </Card>

    <Card className="grid grid-cols-2 gap-5 p-5 lg:grid-cols-4">
      <Stat label="Payable now" value={formatRupees(data.earned.Payable)} tone="text-[var(--ok-ink)]" />
      <Stat label="Still maturing" value={formatRupees(data.earned.Maturing)} />
      <Stat label="Awaiting delivery" value={formatRupees(data.earned.Pending)} />
      <Stat label="Paid out" value={formatRupees(data.earned.Paid)} />
    </Card>

    <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
      <div className="min-w-0">
        <p className="text-sm font-semibold">Next payout run</p>
        <p className="mt-0.5 text-xs text-[var(--muted)]">
          {formatDate(data.nextPayoutDate)} · would cover {periodLabel(data.proposedPeriod)} ·
          {" "}commissions clear {data.holdDays} days after delivery
          {data.lastPayout?.payoutNo ? ` · last run ${data.lastPayout.payoutNo}` : " · nothing has been paid yet"}
        </p>
      </div>
      <LinkButton href="/admin/sales/payouts">Prepare a payout</LinkButton>
    </Card>

    <div>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-base font-semibold">Top partners</h2>
        <Link href="/admin/sales/reps" className="text-sm text-[var(--brand)] hover:underline">All {data.activeReps} partners</Link>
      </div>

      {data.top.length ? (
        <Card className="divide-y divide-[var(--line)]">
          {data.top.map(summary => <RepRow key={summary.rep._id} summary={summary} />)}
        </Card>
      ) : (
        <EmptyState
          icon={setUp ? TrendingUp : Plug}
          title={setUp ? "No attributed orders yet" : "Nothing to show until Shopify is connected"}
          description={setUp
            ? "Orders are attributed by the coupon code on them. Add a partner with their codes, then sync."
            : "Add the Shopify and Shiprocket credentials, add your partners and their coupon codes, then run a sync."}
          action={<LinkButton href={setUp ? "/admin/sales/reps" : "/admin/sales/settings"}>
            <Users size={16} />{setUp ? "Add a partner" : "Open settings"}
          </LinkButton>} />
      )}
    </div>
  </div>;
}

function RepRow({ summary }: { summary: RepSummary }) {
  return <Link href={`/admin/sales/reps/${summary.rep._id}`}
    className="flex flex-wrap items-center gap-4 px-5 py-4 hover:bg-[var(--surface-2)]">
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold">{summary.rep.name}</p>
        <Badge>{summary.rep.code}</Badge>
        {!summary.rep.active && <Badge tone="warn">Inactive</Badge>}
      </div>
      <p className="mt-0.5 text-xs text-[var(--muted)]">
        {summary.orders} order{summary.orders === 1 ? "" : "s"} · {summary.delivered} delivered
        {summary.returned ? ` · ${summary.returned} came back` : ""}
      </p>
    </div>
    <div className="shrink-0 text-right">
      <p className="text-sm font-semibold">{formatRupees(summary.revenue)}</p>
      <p className="text-xs text-[var(--muted)]">
        {formatRupees(summary.payable)} payable · {formatRupees(summary.paid)} paid
      </p>
    </div>
  </Link>;
}
