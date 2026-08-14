"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, PackageSearch } from "lucide-react";
import { Badge, Button, Card, EmptyState, Notice, PageTitle, Spinner, Stat } from "@/components/ui/kit";
import { formatDate } from "@/lib/time";
import { commissionTone, deliveryTone } from "@/lib/sales/delivery";
import { DELIVERY_STATES } from "@/lib/sales/constants";
import { formatRupees, type PartnerOrderRecord } from "@/lib/sales/types";

type Payload = {
  items: PartnerOrderRecord[];
  total: number;
  page: number;
  pages: number;
  summary: { revenue: number; commission: number };
};

/**
 * Every order this rep's codes brought in.
 *
 * Each row leads with the sentence from `trackingHeadline` rather than with a
 * pair of status badges. The badges are there too, on the right, for somebody
 * scanning — but the first thing read is plain English, because the reader is
 * not a member of staff who has learned what "Maturing" means.
 */
export default function PartnerOrdersPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [delivery, setDelivery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: "20" });
    if (delivery) params.set("delivery", delivery);
    const response = await fetch(`/api/partner/orders?${params}`);
    const json = await response.json() as { data?: Payload };
    setData(json.data ?? null);
    setLoading(false);
  }, [page, delivery]);
  useEffect(() => { load(); }, [load]);

  if (loading && !data) return <Spinner label="Loading your orders…" />;
  if (!data) return <Notice tone="error">Could not load your orders.</Notice>;

  return <div className="space-y-5">
    <PageTitle title="Orders" subtitle="Every order one of your codes brought in" />

    <Card className="grid grid-cols-3 gap-4 p-5">
      <Stat label="Orders" value={data.total} />
      <Stat label="Sales" value={formatRupees(data.summary.revenue)} />
      <Stat label="Your commission" value={formatRupees(data.summary.commission)} tone="text-[var(--ok-ink)]" />
    </Card>

    <select className="select" value={delivery}
      onChange={event => { setPage(1); setDelivery(event.target.value); }}>
      <option value="">Every order</option>
      {DELIVERY_STATES.map(state => <option key={state} value={state}>{state}</option>)}
    </select>

    {data.items.length ? (
      <Card className="divide-y divide-[var(--line)]">
        {data.items.map(order => (
          <Link key={order._id} href={`/partner/orders/${order._id}`}
            className="flex items-start gap-3 px-5 py-4 hover:bg-[var(--surface-2)]">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold">{order.name}</p>
                <Badge tone={deliveryTone(order.delivery.state)}>{order.delivery.state}</Badge>
                {order.commission.status !== "Pending" && (
                  <Badge tone={commissionTone(order.commission.status)}>{order.commission.status}</Badge>
                )}
              </div>

              {/* The sentence, not the jargon. */}
              <p className="mt-1 wrap-break-word text-xs text-[var(--ink-2)]">{order.headline}</p>

              <p className="mt-0.5 text-xs text-[var(--muted)]">
                {formatDate(order.placedAt)}
                {order.couponCode ? ` · ${order.couponCode}` : ""}
                {order.customer?.name ? ` · ${order.customer.name}` : ""}
                {order.customer?.city ? ` · ${order.customer.city}` : ""}
              </p>
            </div>

            <div className="shrink-0 text-right">
              <p className="text-sm font-semibold">{formatRupees(order.commission.amount)}</p>
              <p className="text-xs text-[var(--muted)]">{formatRupees(order.totals.paid)} order</p>
            </div>
            <ChevronRight size={16} className="mt-1 shrink-0 text-[var(--muted)]" />
          </Link>
        ))}
      </Card>
    ) : (
      <EmptyState icon={PackageSearch} title={delivery ? "Nothing at that stage" : "No orders yet"}
        description={delivery
          ? "Try a different stage, or look at every order."
          : "Once a customer uses one of your codes, the order appears here and you can follow it all the way to being paid."} />
    )}

    {data.pages > 1 && (
      <div className="flex items-center justify-between">
        <Button tone="secondary" disabled={page <= 1} onClick={() => setPage(current => current - 1)}>Back</Button>
        <span className="text-xs text-[var(--muted)]">Page {data.page} of {data.pages}</span>
        <Button tone="secondary" disabled={page >= data.pages} onClick={() => setPage(current => current + 1)}>Next</Button>
      </div>
    )}
  </div>;
}
