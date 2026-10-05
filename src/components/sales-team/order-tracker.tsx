"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, MapPin, PackageSearch, Search, Truck } from "lucide-react";
import { Badge, Button, Card, Field, Notice, Spinner } from "@/components/ui/kit";
import type { ShiprocketListedOrder, Tracking } from "@/lib/sales/shiprocket";
import { formatRupees } from "@/lib/sales-team/orders";
import { call, messageOf } from "./shared";

type CrmRow = {
  _id: string; name: string; ref?: string; placedAt: string; executiveName?: string;
  customer?: { name?: string; phone?: string; city?: string; pinCode?: string };
  totals?: { paid?: number }; paymentMode?: string; cancelledAt?: string;
  shipment?: { awb?: string; courier?: string; status?: string }; delivery?: { state?: string };
};
type ShipRow = ShiprocketListedOrder & { crmId?: string };
type Result = {
  crm: CrmRow[];
  shiprocket: { items: ShipRow[]; total: number; pages: number; page: number; note?: string };
  refusal?: string;
  trackAwb?: string;
};

const day = (value?: string) => {
  if (!value) return "";
  const date = new Date(value.includes("T") ? value : value.replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
};

const tone = (status?: string) => {
  const word = String(status ?? "").toLowerCase();
  if (word.includes("deliver") && !word.includes("undeliver")) return "success" as const;
  if (word.includes("rto") || word.includes("return") || word.includes("cancel") || word.includes("undeliver") || word.includes("lost")) return "danger" as const;
  if (word.includes("transit") || word.includes("out for") || word.includes("picked") || word.includes("shipped")) return "info" as const;
  return "neutral" as const;
};

/**
 * Find any order and follow it — this CRM's sales orders and every order the
 * Shiprocket account ever shipped, searched together by name, phone, order
 * number or AWB, within a date range. Each result tracks in place, scan by scan.
 */
export function OrderTracker({ basePath }: { basePath: string }) {
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const search = useCallback(async (nextPage = 1) => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ page: String(nextPage) });
      if (q.trim()) params.set("q", q.trim());
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const found = await call<Result>(`/api/sales-team/track?${params}`);
      // Later pages only page through Shiprocket; the CRM matches stay as they were.
      setResult(current => nextPage > 1 && current ? { ...found, crm: current.crm } : found);
      setPage(nextPage);
    } catch (problem) {
      setError(messageOf(problem));
    } finally {
      setLoading(false);
    }
  }, [q, from, to]);

  // The latest orders as the screen opens, so it is never a blank page.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { search(1); }, []);

  const preset = (days: number) => {
    const end = new Date();
    const start = new Date(end.getTime() - (days - 1) * 86_400_000);
    const iso = (date: Date) => date.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    setFrom(iso(start)); setTo(iso(end));
  };

  const crm = result?.crm ?? [];
  const ship = result?.shiprocket;

  return <div className="space-y-4">
    <Card className="space-y-3 p-4 sm:p-5">
      <form className="space-y-3" onSubmit={event => { event.preventDefault(); search(1); }}>
        <Field label="Search" hint="Customer name, phone number, order number (#1042, BHX-SE-…) or AWB.">
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <input className="input !pl-9" value={q} onChange={event => setQ(event.target.value)} placeholder="e.g. Priya, 98765 43210, #1042, 1234567890123" inputMode="search" />
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="From"><input className="input" type="date" value={from} max={to || undefined} onChange={event => setFrom(event.target.value)} /></Field>
          <Field label="To"><input className="input" type="date" value={to} min={from || undefined} onChange={event => setTo(event.target.value)} /></Field>
          <Button type="submit" busy={loading} busyLabel="Searching…" className="col-span-2 sm:col-span-1"><Search size={16} />Search</Button>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          {([["Today", 1], ["7 days", 7], ["30 days", 30], ["90 days", 90]] as const).map(([label, days]) => (
            <button key={label} type="button" onClick={() => preset(days)} className="rounded-full border border-[var(--line-2)] px-3 py-1.5 font-semibold hover:bg-[var(--surface-2)]">{label}</button>
          ))}
          {(from || to || q) && <button type="button" onClick={() => { setQ(""); setFrom(""); setTo(""); }} className="rounded-full px-3 py-1.5 font-semibold text-[var(--brand)] hover:underline">Clear</button>}
        </div>
      </form>
    </Card>

    {error && <Notice tone="error">{error}</Notice>}
    {!result && loading && <Spinner label="Searching orders…" />}

    {result?.trackAwb && (
      <Card className="p-4">
        <TrackRow title={`AWB ${result.trackAwb}`} subtitle="Track this airway bill directly with the courier" url={`/api/sales-team/track/${encodeURIComponent(result.trackAwb)}`} />
      </Card>
    )}

    {result && <section className="space-y-2">
      <h2 className="flex items-center gap-2 text-[15px] font-semibold"><Truck size={16} />Sales CRM orders <span className="text-xs font-normal text-[var(--muted)]">{crm.length}{crm.length === 50 ? "+" : ""}</span></h2>
      {crm.length ? <div className="space-y-2">
        {crm.map(order => (
          <Card key={order._id} className="p-3 sm:p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <Link href={`${basePath}/${order._id}`} className="group min-w-0">
                <p className="flex items-center gap-1 font-semibold group-hover:text-[var(--brand)]">{order.name}<ChevronRight size={14} /></p>
                <p className="text-sm">{order.customer?.name}{order.customer?.phone ? ` · ${order.customer.phone}` : ""}</p>
                <p className="text-xs text-[var(--muted)]">
                  {day(order.placedAt)} · {[order.customer?.city, order.customer?.pinCode].filter(Boolean).join(" ")}
                  {order.executiveName ? ` · ${order.executiveName}` : ""} · {formatRupees(order.totals?.paid ?? 0)}
                </p>
              </Link>
              <Badge tone={order.cancelledAt ? "danger" : tone(order.shipment?.status ?? order.delivery?.state)}>
                {order.cancelledAt ? "Cancelled" : order.shipment?.status || order.delivery?.state || "Placed"}
              </Badge>
            </div>
            {order.shipment?.awb
              ? <TrackRow title={`AWB ${order.shipment.awb}`} subtitle={order.shipment.courier} url={`/api/sales-team/orders/${order._id}/track`} />
              : !order.cancelledAt && <p className="mt-2 text-xs text-[var(--muted)]">Not booked with the courier yet.</p>}
          </Card>
        ))}
      </div> : <p className="text-sm text-[var(--muted)]">No sales CRM order matches.</p>}
    </section>}

    {result && <section className="space-y-2">
      <h2 className="flex items-center gap-2 text-[15px] font-semibold"><PackageSearch size={16} />All Shiprocket orders {ship?.total ? <span className="text-xs font-normal text-[var(--muted)]">{ship.total.toLocaleString("en-IN")}</span> : null}</h2>
      <p className="text-xs text-[var(--muted)]">Every parcel on the Shiprocket account, including website orders from before this CRM.</p>
      {result.refusal && <Notice>{result.refusal}</Notice>}
      {ship?.note && <Notice tone="warning">{ship.note}</Notice>}
      {ship?.items.length ? <div className="space-y-2">
        {ship.items.map(order => (
          <Card key={order.shiprocketOrderId || order.channelOrderId} className="p-3 sm:p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold">
                  {order.crmId ? <Link href={`${basePath}/${order.crmId}`} className="hover:text-[var(--brand)]">{order.channelOrderId || order.shiprocketOrderId}</Link> : order.channelOrderId || order.shiprocketOrderId}
                </p>
                <p className="text-sm">{order.customerName}{order.customerPhone ? ` · ${order.customerPhone}` : ""}</p>
                <p className="text-xs text-[var(--muted)]">
                  {day(order.createdAt)}{order.city || order.pinCode ? <> · <MapPin size={11} className="inline" /> {[order.city, order.pinCode].filter(Boolean).join(" ")}</> : null}
                  {order.total != null ? ` · ${formatRupees(order.total)}` : ""}{order.paymentMethod ? ` · ${order.paymentMethod}` : ""}
                </p>
              </div>
              <Badge tone={tone(order.status)}>{order.status || "—"}</Badge>
            </div>
            {order.awb
              ? <TrackRow title={`AWB ${order.awb}`} subtitle={order.courier} url={`/api/sales-team/track/${encodeURIComponent(order.awb)}`} />
              : <p className="mt-2 text-xs text-[var(--muted)]">No airway bill on this order in Shiprocket.</p>}
          </Card>
        ))}
        {ship.pages > 1 && <div className="flex items-center justify-between gap-2 pt-1">
          <Button tone="secondary" disabled={page <= 1 || loading} onClick={() => search(page - 1)}>Newer</Button>
          <span className="text-xs text-[var(--muted)]">Page {page} of {ship.pages}</span>
          <Button tone="secondary" disabled={page >= ship.pages || loading} onClick={() => search(page + 1)}>Older</Button>
        </div>}
      </div> : !result.refusal && !ship?.note && <p className="text-sm text-[var(--muted)]">No Shiprocket order matches.</p>}
    </section>}
  </div>;
}

/** One airway bill, tracked on demand: a button that opens the courier's scans beneath it. */
function TrackRow({ title, subtitle, url }: { title: string; subtitle?: string; url: string }) {
  const [tracking, setTracking] = useState<Tracking | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

  async function track() {
    if (tracking) { setOpen(value => !value); return; }
    setError("");
    try {
      setTracking((await call<{ tracking: Tracking }>(url)).tracking);
      setOpen(true);
    } catch (problem) {
      setError(messageOf(problem));
    }
  }

  return <div className="mt-3 border-t border-[var(--line)] pt-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm"><span className="font-medium">{title}</span>{subtitle ? <span className="text-[var(--muted)]"> · {subtitle}</span> : null}</p>
      <Button tone="secondary" className="!min-h-[36px] text-xs" busyLabel="Tracking…" onClick={track}><Truck size={14} />{tracking && open ? "Hide" : "Track"}</Button>
    </div>
    {error && <p className="mt-2 text-sm text-[var(--danger-ink)]">{error}</p>}
    {tracking && open && (
      <div className="mt-3 rounded-[10px] bg-[var(--surface-2)] p-3">
        <p className="text-sm font-semibold">{tracking.status ?? "No status yet"}</p>
        <p className="text-xs text-[var(--muted)]">
          {[tracking.courier, tracking.expectedDelivery ? `Expected ${day(tracking.expectedDelivery)}` : "", tracking.deliveredAt ? `Delivered ${day(String(tracking.deliveredAt))}` : ""].filter(Boolean).join(" · ")}
          {tracking.trackUrl ? <> · <a href={tracking.trackUrl} target="_blank" rel="noreferrer" className="text-[var(--brand)] underline">Public tracking link</a></> : null}
        </p>
        {tracking.note && <p className="mt-1 text-sm">{tracking.note}</p>}
        <ol className="mt-2 space-y-2 border-l-2 border-[var(--line-2)] pl-3">
          {tracking.scans.slice(0, 20).map((scan, index) => (
            <li key={index} className="text-sm"><span className="font-medium">{scan.activity}</span><span className="block text-xs text-[var(--muted)]">{[scan.location, scan.at].filter(Boolean).join(" · ")}</span></li>
          ))}
        </ol>
      </div>
    )}
  </div>;
}
