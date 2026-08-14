"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Badge, Card, Notice, Spinner, Stat } from "@/components/ui/kit";
import { OrderTimeline } from "@/components/sales/order-timeline";
import { formatDate } from "@/lib/time";
import { commissionTone, deliveryTone } from "@/lib/sales/delivery";
import type { TrackStep } from "@/lib/sales/tracking";
import { formatRupees, type SalesOrderRecord } from "@/lib/sales/types";

type Payload = {
  order: SalesOrderRecord;
  steps: TrackStep[];
  headline: string;
  progress: number;
  holdDays: number;
};

/**
 * One order, followed from the checkout to the payment.
 *
 * The timeline is the screen. Everything else — the basket, the commission
 * arithmetic, the customer's details — sits under it, because a rep opening this
 * has already decided which order they care about and wants to know where it has
 * got to.
 *
 * The commission is shown as its working (`30% of ₹2,400`) rather than as a
 * figure alone. A number with no derivation is a number to argue about, and this
 * is a payment to somebody outside the company.
 */
export default function PartnerOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const response = await fetch(`/api/partner/orders/${id}`);
    const json = await response.json() as { data?: Payload };
    setData(json.data ?? null);
    setLoading(false);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <Spinner label="Loading the order…" />;
  if (!data) return <div className="space-y-4">
    <Link href="/partner/orders" className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--ink)]">
      <ArrowLeft size={15} />Orders
    </Link>
    <Notice tone="error">We could not find that order.</Notice>
  </div>;

  const { order, steps, headline } = data;
  const refunded = order.totals.refunded > 0;

  return <div className="space-y-5">
    <Link href="/partner/orders" className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--ink)]">
      <ArrowLeft size={15} />Orders
    </Link>

    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-[22px]">{order.name}</h1>
        <Badge tone={deliveryTone(order.delivery.state)}>{order.delivery.state}</Badge>
        <Badge tone={commissionTone(order.commission.status)}>{order.commission.status}</Badge>
      </div>
      <p className="mt-1 text-sm text-[var(--ink-2)]">{headline}</p>
      <p className="mt-0.5 text-xs text-[var(--muted)]">
        {formatDate(order.placedAt)}{order.couponCode ? ` · ${order.couponCode}` : ""}
      </p>
    </div>

    <Card className="p-5">
      <OrderTimeline steps={steps} />
    </Card>

    <Card className="grid grid-cols-2 gap-5 p-5">
      <Stat label="Order value" value={formatRupees(order.totals.paid)} />
      <Stat label="Your commission" value={formatRupees(order.commission.amount)}
        tone={order.commission.amount > 0 ? "text-[var(--ok-ink)]" : undefined} />
    </Card>

    <Card className="p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">How the commission was worked out</p>
      <p className="mt-2 text-sm text-[var(--ink-2)]">
        {order.commission.amount > 0
          ? <>{order.commission.rate}% of {formatRupees(order.commission.base)} — the part of this order your code applied to.</>
          : order.commission.reason || "Nothing is owed on this order."}
      </p>
      {order.commission.status === "Maturing" && order.commission.maturesAt && (
        <p className="mt-1 text-sm text-[var(--ink-2)]">
          It becomes payable on {formatDate(order.commission.maturesAt)}, {data.holdDays} days after delivery.
        </p>
      )}
      {refunded && (
        <p className="mt-1 text-sm text-[var(--warn-ink)]">
          {formatRupees(order.totals.refunded)} was refunded to the customer, and the commission is worked out on what
          they actually kept.
        </p>
      )}
    </Card>

    <Card className="p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">What was ordered</p>
      <ul className="mt-2 space-y-1.5">
        {order.items.map((item, at) => (
          <li key={`${item.sku ?? item.title}-${at}`} className="flex justify-between gap-3 text-sm">
            <span className="min-w-0 wrap-break-word text-[var(--ink-2)]">
              {item.title}{item.quantity > 1 ? ` × ${item.quantity}` : ""}
            </span>
            <span className="shrink-0 tabular-nums text-[var(--muted)]">{formatRupees(item.gross - item.couponDiscount - item.otherDiscount)}</span>
          </li>
        ))}
      </ul>
    </Card>

    {(order.customer?.name || order.customer?.phone || order.customer?.email || order.customer?.city) && (
      <Card className="p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Customer</p>
        <p className="mt-2 wrap-break-word text-sm text-[var(--ink-2)]">
          {[order.customer.name, order.customer.phone, order.customer.email].filter(Boolean).join(" · ") || "—"}
        </p>
        {(order.customer.city || order.customer.state || order.customer.pinCode) && (
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            {[order.customer.city, order.customer.state, order.customer.pinCode].filter(Boolean).join(", ")}
          </p>
        )}
      </Card>
    )}

    {order.shipment?.awb && (
      <Card className="p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Parcel</p>
        <p className="mt-2 text-sm text-[var(--ink-2)]">
          {order.shipment.courier ?? "Courier"} · {order.shipment.awb}
        </p>
        {order.shipment.status && (
          // The courier's own wording, verbatim. What we made of it is already
          // in the timeline; this is the raw fact behind it, which is what a
          // customer service call actually needs.
          <p className="mt-0.5 text-xs text-[var(--muted)]">Courier says: {order.shipment.status}</p>
        )}
      </Card>
    )}
  </div>;
}
