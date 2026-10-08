"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, BellRing, ChevronRight, MessageCircle, PackageCheck, PackagePlus, Phone, RefreshCw, Truck, UserPlus } from "lucide-react";
import { Badge, Button, Card, Notice, Spinner } from "@/components/ui/kit";
import { telUrl, whatsappUrl } from "@/lib/sales/leads";
import { formatRupees, PAYMENT_MODE_LABEL, type TeamPaymentMode } from "@/lib/sales-team/orders";
import { riskTone } from "@/lib/sales-team/risk";
import { formatDate } from "@/lib/time";
import { AddCustomerModal, FollowUpRow, type FollowUpLead } from "./follow-ups";
import { call, messageOf } from "./shared";
import { TrackingDetails } from "./order-tracker";
import type { Tracking } from "@/lib/sales/shiprocket";

type OrderRow = {
  _id: string; name: string; customer?: { name?: string; phone?: string; city?: string };
  collectAmount?: number; paymentMode: TeamPaymentMode; totals: { paid: number };
  shipment?: { awb?: string; courier?: string; status?: string; expectedDelivery?: string; lastError?: string };
  delivery: { state: string }; rtoRisk?: { level?: string }; ndr?: Array<{ at: string; action: string; deferredDate?: string; ok?: boolean }>;
};
type Payload = {
  today: string;
  deliveringToday: OrderRow[]; tomorrow: OrderRow[]; problems: OrderRow[]; unbooked: OrderRow[];
  followUps: FollowUpLead[]; upcomingFollowUps: number; inTransit: number;
  month: { orders: number; value: number; delivered: number; returned: number; pending: number; payable: number; paid: number };
};

/** What the executive says to a customer whose parcel arrives today, ready to send. */
export function deliveryMessage(order: Pick<OrderRow, "name" | "customer" | "collectAmount" | "shipment">, when: "today" | "tomorrow" = "today") {
  const first = order.customer?.name?.split(" ")[0] ?? "";
  const cash = (order.collectAmount ?? 0) > 0 ? ` Please keep ${formatRupees(order.collectAmount ?? 0)} ready for the delivery person.` : "";
  const track = order.shipment?.awb ? ` Track it: https://shiprocket.co/tracking/${order.shipment.awb}` : "";
  return `Hello ${first}, your BHEALIX order ${order.name} will be delivered ${when}${order.shipment?.courier ? ` by ${order.shipment.courier}` : ""}.${cash} Please make sure someone is available to receive it.${track}`;
}

const waLink = (phone: string | undefined, text: string) => {
  const base = whatsappUrl(phone);
  return base ? `${base}?text=${encodeURIComponent(text)}` : null;
};

/**
 * The executive's front page: who to ring today, and why.
 *
 * Ordered by what costs money if it waits — a failed delivery becomes a return by
 * default, a parcel arriving today to somebody who is out becomes a failed
 * delivery — then the orders waiting to be shipped and the follow-ups whose day has
 * come. Opening it asks Shiprocket what has shipped or moved since.
 */
export function ExecutiveToday({ name }: { name: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try { setData(await call<Payload>("/api/sales-team/today")); setError(""); } catch (problem) { setError(messageOf(problem)); }
  }, []);
  useEffect(() => { load(); }, [load]);
  // Then ask Shiprocket, quietly, what has shipped or moved since, and show it.
  useEffect(() => {
    call<{ updated: number }>("/api/sales-team/orders/refresh?auto=1", { method: "POST" })
      .then(result => { if (result.updated) load(); })
      .catch(() => undefined);
  }, [load]);

  async function refresh() {
    setRefreshing(true); setNotice("");
    try {
      const result = await call<{ checked: number; updated: number; shipped?: number }>("/api/sales-team/orders/refresh", { method: "POST" });
      setNotice(`Checked ${result.checked} order${result.checked === 1 ? "" : "s"} with Shiprocket.${result.shipped ? ` ${result.shipped} newly shipped.` : ""}`);
      await load();
    } catch (problem) { setNotice(messageOf(problem)); } finally { setRefreshing(false); }
  }

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <Spinner label="Getting your day ready…" />;

  const first = name.split(" ")[0] || "there";
  const nothing = !data.deliveringToday.length && !data.problems.length && !data.unbooked.length && !data.followUps.length;

  return <div className="space-y-5">
    <div className="flex items-start justify-between gap-3">
      <div>
        <h1 className="text-[22px] sm:text-2xl">Hello, {first}</h1>
        <p className="mt-0.5 text-sm text-[var(--muted)]">{formatDate(data.today)} · {data.inTransit} parcel{data.inTransit === 1 ? "" : "s"} on the way</p>
      </div>
      <Button tone="secondary" className="!min-h-[40px] shrink-0 !px-3 text-xs" busy={refreshing} onClick={refresh}><RefreshCw size={14} />Refresh</Button>
    </div>
    {notice && <Notice>{notice}</Notice>}

    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
      <Link href="/executive/orders/new" className="card tap flex items-center gap-2.5 px-3.5 py-3 text-sm font-semibold hover:bg-[var(--surface-2)]"><PackagePlus size={18} className="text-[var(--brand)]" />New order</Link>
      <button onClick={() => setAdding(true)} className="card tap flex items-center gap-2.5 px-3.5 py-3 text-left text-sm font-semibold hover:bg-[var(--surface-2)]"><UserPlus size={18} className="text-[var(--brand)]" />Add customer</button>
      <Link href="/executive/follow-ups" className="card tap flex items-center gap-2.5 px-3.5 py-3 text-sm font-semibold hover:bg-[var(--surface-2)]"><BellRing size={18} className="text-[var(--brand)]" />Follow-ups</Link>
      <Link href="/executive/leads" className="card tap flex items-center gap-2.5 px-3.5 py-3 text-sm font-semibold hover:bg-[var(--surface-2)]"><Phone size={18} className="text-[var(--brand)]" />My leads</Link>
    </div>

    {nothing && <Card className="p-5 text-sm text-[var(--muted)]">Nothing urgent today. Ring your leads, or check your follow-ups coming up this week ({data.upcomingFollowUps}).</Card>}

    {data.problems.length > 0 && (
      <Section icon={AlertTriangle} tone="danger" title="Delivery failed — call and reschedule" count={data.problems.length}
        hint="The courier could not deliver these. Ring the customer, then set a new day or a reattempt from the order. Left alone, they go back as returns.">
        {data.problems.map(order => <OrderCall key={order._id} order={order} action="Reschedule" message={`Hello ${order.customer?.name?.split(" ")[0] ?? ""}, the courier tried to deliver your BHEALIX order ${order.name} but could not. When would be a good day and time to deliver it?`} />)}
      </Section>
    )}

    {data.deliveringToday.length > 0 && (
      <Section icon={Truck} tone="info" title="Delivering today — call the customer" count={data.deliveringToday.length}
        hint="Make sure they are in, and have the cash ready on a COD order.">
        {data.deliveringToday.map(order => <OrderCall key={order._id} order={order} message={deliveryMessage(order)} />)}
      </Section>
    )}

    {data.followUps.length > 0 && (
      <Section icon={BellRing} tone="warn" title="Follow-ups due" count={data.followUps.length} hint="People you promised to call back.">
        {data.followUps.map(lead => <FollowUpRow key={lead._id} lead={lead} today={data.today} onChanged={load} />)}
      </Section>
    )}

    {data.unbooked.length > 0 && (
      <Section icon={PackageCheck} tone="neutral" title="Waiting to be shipped" count={data.unbooked.length} hint="The office ships these through Shiprocket. They move on their own once shipped.">
        {data.unbooked.map(order => (
          <Link key={order._id} href={`/executive/orders/${order._id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--surface-2)]">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{order.name} · {order.customer?.name}</p>
              <p className="truncate text-xs text-[var(--muted)]">{order.customer?.city} · {formatRupees(order.totals.paid)} · {PAYMENT_MODE_LABEL[order.paymentMode]}{order.shipment?.lastError ? " · booking failed" : ""}</p>
            </div>
            {order.rtoRisk?.level && <Badge tone={riskTone(order.rtoRisk.level)}>{order.rtoRisk.level} risk</Badge>}
            <ChevronRight size={16} className="text-[var(--muted)]" />
          </Link>
        ))}
      </Section>
    )}

    {data.tomorrow.length > 0 && (
      <Section icon={Truck} tone="neutral" title="Arriving tomorrow" count={data.tomorrow.length} hint="A message today saves a failed delivery tomorrow.">
        {data.tomorrow.map(order => <OrderCall key={order._id} order={order} message={deliveryMessage(order, "tomorrow")} />)}
      </Section>
    )}

    <Card className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
      <Figure label="Orders this month" value={String(data.month.orders)} />
      <Figure label="Delivered" value={`${data.month.delivered}${data.month.returned ? ` · ${data.month.returned} back` : ""}`} />
      <Figure label="Incentive owed" value={formatRupees(data.month.payable)} />
      <Figure label="On the way" value={formatRupees(data.month.pending)} />
    </Card>
    <Link href="/executive/performance" className="block text-center text-sm font-semibold text-[var(--brand)]">See all my numbers</Link>

    {adding && <AddCustomerModal onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
  </div>;
}

function Section({ icon: Icon, title, count, hint, tone, children }: {
  icon: React.ComponentType<{ size?: number; className?: string }>; title: string; count: number; hint?: string;
  tone: "danger" | "info" | "warn" | "neutral"; children: React.ReactNode;
}) {
  const colour = { danger: "text-[var(--danger-ink)]", info: "text-[var(--info-ink)]", warn: "text-[var(--warn-ink)]", neutral: "text-[var(--ink-2)]" }[tone];
  return <section>
    <div className="mb-2 px-1">
      <h2 className={`flex items-center gap-2 text-[15px] font-semibold ${colour}`}><Icon size={17} />{title}<span className="text-[var(--muted)]">({count})</span></h2>
      {hint && <p className="mt-0.5 text-xs text-[var(--muted)]">{hint}</p>}
    </div>
    <Card className="divide-y divide-[var(--line)]">{children}</Card>
  </section>;
}

function OrderCall({ order, message, action }: { order: OrderRow; message: string; action?: string }) {
  const tel = telUrl(order.customer?.phone);
  const wa = waLink(order.customer?.phone, message);
  const lastAsk = order.ndr?.at(-1);
  // The courier's scans, opened in place — no need to leave the day's list to see where a parcel is.
  const [tracking, setTracking] = useState<Tracking | null>(null);
  const [open, setOpen] = useState(false);
  const [trackError, setTrackError] = useState("");
  async function track() {
    if (tracking) { setOpen(value => !value); return; }
    setTrackError("");
    try {
      const result = await call<{ tracking: Tracking | null }>(`/api/sales-team/orders/${order._id}/track`);
      if (result.tracking) { setTracking(result.tracking); setOpen(true); } else setTrackError("No courier scans for this order yet.");
    } catch (problem) { setTrackError(messageOf(problem)); }
  }
  return <div className="px-4 py-3">
    <Link href={`/executive/orders/${order._id}`} className="block">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">{order.customer?.name}</span>
        <span className="text-xs text-[var(--muted)]">{order.name}</span>
        {order.rtoRisk?.level && order.rtoRisk.level !== "Low" && <Badge tone={riskTone(order.rtoRisk.level)}>{order.rtoRisk.level} risk</Badge>}
      </div>
      <p className="mt-0.5 text-xs text-[var(--muted)]">
        {order.customer?.city} · {(order.collectAmount ?? 0) > 0 ? `collect ${formatRupees(order.collectAmount ?? 0)}` : "prepaid"}
        {order.shipment?.courier ? ` · ${order.shipment.courier}` : ""}{order.shipment?.status ? ` · ${order.shipment.status}` : ""}
      </p>
      {lastAsk && <p className="mt-0.5 text-xs text-[var(--muted)]">Last asked: {lastAsk.action === "return" ? "return" : `reattempt${lastAsk.deferredDate ? ` on ${lastAsk.deferredDate}` : ""}`}{lastAsk.ok === false ? " (refused)" : ""}</p>}
    </Link>
    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {tel ? <a href={tel} className="tap inline-flex items-center justify-center gap-1.5 rounded-[10px] bg-[var(--brand)] text-xs font-semibold text-[var(--on-brand)]"><Phone size={14} />Call</a> : <span />}
      {wa ? <a href={wa} target="_blank" rel="noreferrer" className="tap inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-[var(--ok-line)] text-xs font-semibold text-[var(--ok-ink)]"><MessageCircle size={14} />WhatsApp</a> : <span />}
      <Link href={`/executive/orders/${order._id}`} className="tap inline-flex items-center justify-center gap-1 rounded-[10px] border border-[var(--line-2)] text-xs font-semibold">{action ?? "Open"}<ChevronRight size={13} /></Link>
      <Button tone="secondary" className="!min-h-[44px] text-xs" busyLabel="Tracking…" onClick={track}><Truck size={14} />{tracking && open ? "Hide" : "Track"}</Button>
    </div>
    {trackError && <p className="mt-2 text-sm text-[var(--danger-ink)]">{trackError}</p>}
    {tracking && open && <TrackingDetails tracking={tracking} />}
  </div>;
}

function Figure({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><p className="truncate text-xs text-[var(--muted)]">{label}</p><p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p></div>;
}
