"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, PackageSearch } from "lucide-react";
import { Badge, Card, EmptyState, Notice, Spinner, Stat } from "@/components/ui/kit";
import { DELIVERY_STATES } from "@/lib/sales/constants";
import { deliveryTone } from "@/lib/sales/delivery";
import { formatRupees, INCENTIVE_STATUSES, incentiveTone, PAYMENT_MODE_LABEL, TEAM_PAYMENT_MODES } from "@/lib/sales-team/orders";
import { formatDate } from "@/lib/time";
import { isOutForDelivery, riskTone } from "@/lib/sales-team/risk";
import { call, executiveNameOf, messageOf, type TeamOrderRow } from "./shared";

type Page = {
  items: TeamOrderRow[]; total: number; page: number; pages: number;
  summary: { orders: number; value: number; delivered: number; pending: number; payable: number; paid: number };
};

const DUE_FILTERS = [
  { value: "", label: "Any delivery day" },
  { value: "today", label: "Arriving today" },
  { value: "tomorrow", label: "Arriving tomorrow" }
];

const indianDay = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

/** "Arriving today" / "tomorrow" on a moving parcel — the call to make before the courier knocks. */
function arrivalOf(order: TeamOrderRow): string | null {
  if (order.cancelledAt || !order.shipment?.awb || !["Awaiting", "In transit", "Undelivered"].includes(order.delivery.state)) return null;
  if (isOutForDelivery(order.shipment.status)) return "Out for delivery";
  const expected = String(order.shipment.expectedDelivery ?? "").slice(0, 10);
  if (expected === indianDay(0)) return "Arriving today";
  if (expected === indianDay(1)) return "Arriving tomorrow";
  return null;
}

const PROCESS_FILTERS = [
  { value: "", label: "Any stage" },
  { value: "unbooked", label: "Not booked yet" },
  { value: "booked", label: "Booked with courier" },
  { value: "failed", label: "Booking failed" },
  { value: "cancelled", label: "Cancelled" }
];

/**
 * The sales team's orders as a list — an executive's own, or everybody's with a
 * filter for whose. The figures above it cover everything the filter found, not
 * just the page on screen. With `autoRefresh` (the executive's own list), opening
 * it asks Shiprocket what has shipped or moved since, and shows it.
 */
export function OrderTable({ basePath, showExecutive, autoRefresh = false }: { basePath: string; showExecutive: boolean; autoRefresh?: boolean }) {
  const params = useSearchParams();
  const [filters, setFilters] = useState({
    q: "", status: params.get("status") ?? "", mode: params.get("mode") ?? "", delivery: params.get("delivery") ?? "",
    incentive: params.get("incentive") ?? "", executive: params.get("executive") ?? "", due: params.get("due") ?? "", from: "", to: ""
  });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page | null>(null);
  const [executives, setExecutives] = useState<Array<{ _id: string; name: string }>>([]);
  const [error, setError] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    if (showExecutive) call<{ items: Array<{ _id: string; name: string }> }>("/api/sales-team/executives?active=all").then(result => setExecutives(result.items)).catch(() => undefined);
  }, [showExecutive]);

  const load = useCallback(async () => {
    const query = new URLSearchParams({ page: String(page), limit: "25" });
    for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
    try {
      setData(await call<Page>(`/api/sales-team/orders?${query}`));
      setError("");
    } catch (problem) {
      setError(messageOf(problem));
    }
  }, [filters, page]);
  useEffect(() => { const timer = setTimeout(load, 250); return () => clearTimeout(timer); }, [load]);

  const [synced, setSynced] = useState(0);
  useEffect(() => {
    if (!autoRefresh) return;
    call<{ updated: number }>("/api/sales-team/orders/refresh?auto=1", { method: "POST" })
      .then(result => { if (result.updated) setSynced(count => count + 1); })
      .catch(() => undefined);
  }, [autoRefresh]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (synced) load(); }, [synced]);

  const set = (key: keyof typeof filters, value: string) => { setPage(1); setFilters(current => ({ ...current, [key]: value })); };

  return <div className="space-y-4">
    {/* On a phone the search stays and the rest of the filters fold away behind one button. */}
    <div className="flex gap-2 sm:hidden">
      <input className="input flex-1" placeholder="Order, customer, phone or AWB" value={filters.q} onChange={event => set("q", event.target.value)} />
      <button type="button" onClick={() => setShowFilters(value => !value)} className="tap rounded-[10px] border border-[var(--line-2)] px-3 text-sm font-semibold">Filters</button>
    </div>
    <Card className={`${showFilters ? "grid" : "hidden"} gap-3 p-4 sm:grid sm:grid-cols-2 lg:grid-cols-4`}>
      <input className="input hidden sm:block lg:col-span-2" placeholder="Order, customer, phone, city or AWB" value={filters.q} onChange={event => set("q", event.target.value)} />
      {showExecutive && (
        <select className="select" value={filters.executive} onChange={event => set("executive", event.target.value)} aria-label="Executive">
          <option value="">Every executive</option>
          {executives.map(person => <option key={person._id} value={person._id}>{person.name}</option>)}
        </select>
      )}
      <select className="select" value={filters.status} onChange={event => set("status", event.target.value)} aria-label="Stage">
        {PROCESS_FILTERS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <select className="select" value={filters.mode} onChange={event => set("mode", event.target.value)} aria-label="Payment">
        <option value="">Any payment</option>
        {TEAM_PAYMENT_MODES.map(mode => <option key={mode} value={mode}>{PAYMENT_MODE_LABEL[mode]}</option>)}
      </select>
      <select className="select" value={filters.delivery} onChange={event => set("delivery", event.target.value)} aria-label="Delivery">
        <option value="">Any delivery state</option>
        {DELIVERY_STATES.map(state => <option key={state} value={state}>{state}</option>)}
      </select>
      <select className="select" value={filters.due} onChange={event => set("due", event.target.value)} aria-label="Delivery day">
        {DUE_FILTERS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <select className="select" value={filters.incentive} onChange={event => set("incentive", event.target.value)} aria-label="Incentive">
        <option value="">Any incentive</option>
        {INCENTIVE_STATUSES.map(status => <option key={status} value={status}>{status}</option>)}
      </select>
      <input type="date" className="input" value={filters.from} onChange={event => set("from", event.target.value)} aria-label="From" />
      <input type="date" className="input" value={filters.to} onChange={event => set("to", event.target.value)} aria-label="To" />
    </Card>

    {error && <Notice tone="error">{error}</Notice>}
    {!data && !error && <Spinner label="Loading orders…" />}

    {data && <>
      <Card className="grid grid-cols-2 gap-5 p-5 sm:grid-cols-5">
        <Stat label="Orders" value={data.summary.orders} />
        <Stat label="Value" value={formatRupees(Math.round(data.summary.value))} />
        <Stat label="Delivered" value={data.summary.delivered} />
        <Stat label="Incentive owed" value={formatRupees(data.summary.payable)} />
        <Stat label="Incentive paid" value={formatRupees(data.summary.paid)} tone="text-[var(--ok-ink)]" />
      </Card>

      {!data.items.length ? (
        <EmptyState icon={PackageSearch} title="No orders here" description="Nothing matches these filters yet." />
      ) : (
        <Card className="divide-y divide-[var(--line)]">
          {data.items.map(order => (
            <Link key={order._id} href={`${basePath}/${order._id}`} className="flex flex-wrap items-start gap-3 px-4 py-3.5 hover:bg-[var(--surface-2)] sm:px-5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{order.name}</span>
                  {order.cancelledAt ? <Badge tone="danger">Cancelled</Badge> : <Badge tone={deliveryTone(order.delivery.state)}>{order.delivery.state}</Badge>}
                  {!order.cancelledAt && !order.shipment?.awb && <Badge tone={order.shipment?.lastError ? "danger" : "warn"}>{order.shipment?.lastError ? "Booking failed" : showExecutive ? "Not booked" : "Not shipped yet"}</Badge>}
                  {arrivalOf(order) && <Badge tone="info">{arrivalOf(order)}</Badge>}
                  <Badge>{PAYMENT_MODE_LABEL[order.paymentMode]}</Badge>
                  {order.channel === "Shopify" && <Badge tone="info">Shopify</Badge>}
                  {order.rtoRisk?.level && order.rtoRisk.level !== "Low" && !order.cancelledAt && <Badge tone={riskTone(order.rtoRisk.level)}>{order.rtoRisk.level} risk</Badge>}
                  {order.incentive.needsReversal && <Badge tone="danger">Needs recovery</Badge>}
                </div>
                <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
                  {formatDate(order.placedAt)}{order.ref && order.ref !== order.name ? ` · ${order.ref}` : ""} · {order.customer?.name}{order.customer?.city ? `, ${order.customer.city}` : ""}
                  {showExecutive ? ` · ${executiveNameOf(order)}` : ""}
                  {order.shipment?.courier ? ` · ${order.shipment.courier}` : ""}
                </p>
                <p className="mt-0.5 truncate text-xs text-[var(--muted)]">{order.items.map(item => `${item.title}${item.quantity > 1 ? ` ×${item.quantity}` : ""}`).join(", ")}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-semibold tabular-nums">{formatRupees(order.totals.paid)}</p>
                <p className="mt-0.5 flex items-center justify-end gap-1.5 text-xs text-[var(--muted)]">
                  {formatRupees(order.incentive.amount)} <Badge tone={incentiveTone(order.incentive.status)}>{order.incentive.status}</Badge>
                </p>
              </div>
            </Link>
          ))}
        </Card>
      )}

      {data.pages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="tap grid place-items-center rounded-[10px] disabled:opacity-30" aria-label="Previous page"><ChevronLeft size={18} /></button>
          <span>Page {data.page} of {data.pages}</span>
          <button disabled={page >= data.pages} onClick={() => setPage(page + 1)} className="tap grid place-items-center rounded-[10px] disabled:opacity-30" aria-label="Next page"><ChevronRight size={18} /></button>
        </div>
      )}
    </>}
  </div>;
}
