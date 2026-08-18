"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Wallet } from "lucide-react";
import { Badge, Button, Card, EmptyState, Notice, PageTitle, Spinner, Stat } from "@/components/ui/kit";
import { PayCommission, paymentSummary, UnpayButton, type PayableLike, type PayeeLike } from "@/components/sales/pay-commission";
import { formatDate } from "@/lib/time";
import { formatRupees, type SalesOrderRecord } from "@/lib/sales/types";

type Rep = PayeeLike & { _id: string; active?: boolean };
type OwedOrder = Omit<SalesOrderRecord, "rep"> & { rep?: Rep | string | null };

type Payload = {
  owed: OwedOrder[];
  paid: OwedOrder[];
  paidTotal: number;
  page: number;
  pages: number;
  totals: {
    owed: { count: number; amount: number };
    paid: { count: number; amount: number };
    pending: { count: number; amount: number };
    needsAttention: number;
  };
  mayPay: boolean;
};

const repOf = (order: OwedOrder): Rep | null => (typeof order.rep === "object" && order.rep ? order.rep : null);

/**
 * Paying partners, one delivered order at a time.
 *
 * There is no run to prepare and nothing to approve. A parcel is delivered, the
 * order's commission becomes owed, and it appears here under the partner's name
 * with a Pay button beside it. Somebody sends the money from their phone,
 * presses Pay, and says when and how — and the partner sees the same line on
 * their own screen a moment later. The bottom half is the record of every
 * payment made that way.
 */
export default function SalesPayoutsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState<PayableLike | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(`/api/sales/payouts?page=${page}&limit=50`);
    const json = await response.json() as { data?: Payload };
    setData(json.data ?? null);
    setLoading(false);
  }, [page]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <Spinner label="Loading what is owed…" />;
  if (!data) return <Notice tone="error">Could not load payouts.</Notice>;

  // Owed orders grouped by partner, so ten deliveries for one person read as one
  // total to send rather than ten separate transfers to remember.
  const groups = new Map<string, { rep: Rep | null; orders: OwedOrder[]; amount: number }>();
  for (const order of data.owed) {
    const rep = repOf(order);
    const key = rep?._id ?? "unknown";
    const group = groups.get(key) ?? { rep, orders: [], amount: 0 };
    group.orders.push(order);
    group.amount += order.commission.amount;
    groups.set(key, group);
  }
  const owedGroups = [...groups.values()].sort((a, b) => b.amount - a.amount);

  return <div className="space-y-5">
    <PageTitle title="Payouts" subtitle="Commission is owed the moment a parcel is delivered, and paid one order at a time" />

    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

    {data.totals.needsAttention > 0 && (
      <Notice tone="warning">
        <span className="inline-flex items-center gap-1.5">
          <AlertTriangle size={15} />
          {data.totals.needsAttention} paid order{data.totals.needsAttention === 1 ? " has" : "s have"} since come back.{" "}
          <Link href="/admin/sales/orders?attention=1" className="underline">Review {data.totals.needsAttention === 1 ? "it" : "them"}</Link> —
          {" "}money already sent is recovered by agreement, not undone here.
        </span>
      </Notice>
    )}

    <Card className="grid grid-cols-2 gap-5 p-5 lg:grid-cols-4">
      <Stat label="To pay now" value={formatRupees(data.totals.owed.amount)} tone={data.totals.owed.count ? "text-[var(--ok-ink)]" : undefined} />
      <Stat label="Orders waiting" value={data.totals.owed.count} />
      <Stat label="Awaiting delivery" value={formatRupees(data.totals.pending.amount)} />
      <Stat label="Paid out" value={formatRupees(data.totals.paid.amount)} />
    </Card>

    <section className="space-y-2">
      <h2 className="text-base font-semibold">Waiting to be paid</h2>
      {owedGroups.length ? owedGroups.map(group => (
        <Card key={group.rep?._id ?? "unknown"} className="divide-y divide-[var(--line)]">
          <div className="flex flex-wrap items-center gap-3 px-5 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                {group.rep
                  ? <Link href={`/admin/sales/reps/${group.rep._id}`} className="text-sm font-semibold hover:underline">{group.rep.name}</Link>
                  : <p className="text-sm font-semibold">Unknown partner</p>}
                {group.rep?.code && <Badge>{group.rep.code}</Badge>}
                {group.rep && group.rep.active === false && <Badge tone="warn">Inactive</Badge>}
              </div>
              <p className="mt-0.5 text-xs text-[var(--muted)]">
                {group.orders.length} order{group.orders.length === 1 ? "" : "s"} · pays by {group.rep?.payMethod ?? "UPI"}
                {group.rep?.payMethod === "UPI" || !group.rep?.payMethod
                  ? group.rep?.upiId ? ` · ${group.rep.upiId}` : " · no UPI id on file"
                  : group.rep?.bankAccountNo ? ` · a/c ending ${String(group.rep.bankAccountNo).slice(-4)}` : " · no account on file"}
              </p>
            </div>
            <p className="shrink-0 text-base font-semibold tabular-nums">{formatRupees(group.amount)}</p>
          </div>

          {group.orders.map(order => (
            <div key={order._id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {order.name}
                  <span className="ml-2 text-xs font-normal text-[var(--muted)]">
                    {order.couponCode ? `${order.couponCode} · ` : ""}
                    delivered {formatDate(order.shipment?.deliveredAt ?? order.delivery.at ?? order.placedAt)}
                    {order.customer?.city ? ` · ${order.customer.city}` : ""}
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-[var(--muted)]">
                  {order.items.map(item => `${item.title}${item.quantity > 1 ? ` ×${item.quantity}` : ""}`).join(", ")}
                  {" · "}{order.commission.rate}% of {formatRupees(order.commission.base)}
                </p>
              </div>
              <p className="shrink-0 text-sm font-semibold tabular-nums">{formatRupees(order.commission.amount)}</p>
              {data.mayPay && (
                <Button className="min-h-[36px] shrink-0 px-3" onClick={() => setPaying(order)}>
                  <Wallet size={14} />Pay
                </Button>
              )}
            </div>
          ))}
        </Card>
      )) : (
        <EmptyState icon={CheckCircle2} title="Nothing waiting to be paid"
          description="Every delivered order has been paid. The next parcel a courier delivers will appear here with a Pay button beside it." />
      )}
    </section>

    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Paid</h2>
        {data.pages > 1 && (
          <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
            <button className="underline disabled:no-underline disabled:opacity-40" disabled={page <= 1} onClick={() => setPage(page - 1)}>Newer</button>
            <span>{page} / {data.pages}</span>
            <button className="underline disabled:no-underline disabled:opacity-40" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Older</button>
          </div>
        )}
      </div>
      {data.paid.length ? (
        <Card className="divide-y divide-[var(--line)]">
          {data.paid.map(order => {
            const rep = repOf(order);
            return <div key={order._id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium">{order.name}</p>
                  {rep && <span className="text-xs text-[var(--muted)]">{rep.name}{rep.code ? ` · ${rep.code}` : ""}</span>}
                  {!rep && order.repSnapshot?.name && <span className="text-xs text-[var(--muted)]">{order.repSnapshot.name} (deleted)</span>}
                  {order.commission.needsReversal && <Badge tone="danger">Came back after payment</Badge>}
                </div>
                <p className="mt-0.5 text-xs text-[var(--muted)]">
                  {paymentSummary(order.commission.payment, { withPayer: true })}
                  {order.commission.payment?.note ? ` · ${order.commission.payment.note}` : ""}
                </p>
              </div>
              <p className="shrink-0 text-sm font-semibold tabular-nums">{formatRupees(order.commission.amount)}</p>
              {data.mayPay && (
                <UnpayButton orderId={order._id}
                  onDone={() => { setNotice({ tone: "success", text: `The payment on ${order.name} was taken back.` }); load(); }}
                  onError={message => setNotice({ tone: "error", text: message })} />
              )}
            </div>;
          })}
        </Card>
      ) : (
        <Card className="p-5 text-sm text-[var(--muted)]">No commission has been paid yet.</Card>
      )}
    </section>

    {paying && (
      <PayCommission order={paying} onClose={() => setPaying(null)}
        onPaid={() => {
          setNotice({ tone: "success", text: `${paying.name} is marked paid. The partner can see it now.` });
          setPaying(null);
          load();
        }} />
    )}
  </div>;
}
