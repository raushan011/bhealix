"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Clock, Wallet } from "lucide-react";
import { Badge, Card, EmptyState, Notice, PageTitle, Spinner, Stat } from "@/components/ui/kit";
import { formatDate } from "@/lib/time";
import { formatRupees, type CommissionPayment } from "@/lib/sales/types";

type Line = {
  _id: string;
  name?: string;
  placedAt?: string;
  couponCode?: string;
  items?: { title: string; quantity: number }[];
  shipment?: { deliveredAt?: string };
  delivery?: { at?: string; state?: string };
  commission: { amount: number; rate?: number; base?: number; status: string; payment?: CommissionPayment; needsReversal?: boolean };
};

type Payload = {
  owed: Line[];
  paid: Line[];
  totals: { owed: { count: number; amount: number }; paid: { count: number; amount: number }; pending: { count: number; amount: number } };
};

/**
 * What the rep is owed and what they have been paid, order by order.
 *
 * Every line is one order, because that is how they are paid: a parcel is
 * delivered, the commission on it is owed, the company sends it and marks it
 * paid, and the line moves from the top list to the bottom one with the day and
 * the reference on it. "₹1,800 in August" is a figure to be suspicious of;
 * "#1042, ₹450, paid 12 Aug by UPI, ref 4217…" is a receipt.
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
    <PageTitle title="Payments" subtitle="Each delivered order is paid on its own, and listed here when it is" />

    <Card className="grid grid-cols-3 gap-4 p-5">
      <Stat label="Owed to you" value={formatRupees(data.totals.owed.amount)}
        tone={data.totals.owed.count ? "text-[var(--ok-ink)]" : undefined} />
      <Stat label="Paid to you" value={formatRupees(data.totals.paid.amount)} />
      <Stat label="Still on its way" value={formatRupees(data.totals.pending.amount)} />
    </Card>

    <section className="space-y-2">
      <h2 className="text-base font-semibold">Owed to you</h2>
      {data.owed.length ? (
        <Card className="divide-y divide-[var(--line)]">
          {data.owed.map(line => <OrderLine key={line._id} line={line} />)}
        </Card>
      ) : (
        <Card className="flex items-start gap-3 p-4 text-sm text-[var(--muted)]">
          <Clock size={16} className="mt-0.5 shrink-0" />
          <span>
            Nothing is waiting to be paid right now. Commission is owed the moment a parcel is delivered —
            {data.totals.pending.count > 0
              ? ` ${data.totals.pending.count} of your order${data.totals.pending.count === 1 ? " is" : "s are"} still on the way.`
              : " your next delivered order will appear here."}
          </span>
        </Card>
      )}
    </section>

    <section className="space-y-2">
      <h2 className="text-base font-semibold">Paid</h2>
      {data.paid.length ? (
        <Card className="divide-y divide-[var(--line)]">
          {data.paid.map(line => <OrderLine key={line._id} line={line} paid />)}
        </Card>
      ) : (
        <EmptyState icon={Wallet} title="No payments yet"
          description="When the company pays you for a delivered order, it appears here with the date and the reference." />
      )}
    </section>
  </div>;
}

function OrderLine({ line, paid = false }: { line: Line; paid?: boolean }) {
  const payment = line.commission.payment;
  const delivered = line.shipment?.deliveredAt ?? line.delivery?.at;
  return <Link href={`/partner/orders/${line._id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--surface-2)]">
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold">{line.name ?? "Order"}</p>
        {paid
          ? <Badge tone="success">Paid</Badge>
          : <Badge tone="info">Delivered · owed</Badge>}
        {line.commission.needsReversal && <Badge tone="danger">Came back after payment</Badge>}
      </div>
      <p className="mt-0.5 text-xs text-[var(--muted)]">
        {(line.items ?? []).map(item => `${item.title}${item.quantity > 1 ? ` ×${item.quantity}` : ""}`).join(", ")}
        {line.commission.rate ? ` · ${line.commission.rate}% of ${formatRupees(line.commission.base ?? 0)}` : ""}
      </p>
      <p className="mt-0.5 text-xs text-[var(--muted)]">
        {paid && payment
          ? [
              payment.paymentDate ? `Paid ${formatDate(payment.paymentDate)}` : payment.paidAt ? `Paid ${formatDate(payment.paidAt)}` : "Paid",
              payment.mode,
              payment.reference ? `ref ${payment.reference}` : null,
              payment.note
            ].filter(Boolean).join(" · ")
          : delivered ? `Delivered ${formatDate(delivered)}` : line.placedAt ? `Placed ${formatDate(line.placedAt)}` : ""}
      </p>
    </div>
    <div className="flex shrink-0 items-center gap-2">
      <p className="text-sm font-semibold tabular-nums">{formatRupees(line.commission.amount)}</p>
      {paid && <CheckCircle2 size={16} className="text-[var(--ok-ink)]" />}
    </div>
  </Link>;
}
