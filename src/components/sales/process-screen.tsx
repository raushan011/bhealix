"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, PackageSearch, Tag, Truck } from "lucide-react";
import { Badge, Button, Card, EmptyState, Field, Notice, PageTitle, Spinner, Stat } from "@/components/ui/kit";
import { ProcessDialog, downloadDocuments } from "@/components/sales/process-orders";
import { SyncButton } from "@/components/sales/sync-button";
import { formatDate } from "@/lib/time";
import { deliveryTone } from "@/lib/sales/delivery";
import { DELIVERY_STATES } from "@/lib/sales/constants";
import { addressOf, blockedReason, missingFields, orderCount, paymentModeOf, processStateOf, processTone } from "@/lib/sales/fulfilment";
import { formatRupees, type FulfilmentOptions, type SalesOrderRecord, type SalesRepRecord } from "@/lib/sales/types";

/**
 * The morning's picking list.
 *
 * Deliberately a different screen from Orders next door, which answers "what did
 * this coupon bring in" and is read by whoever is asking about commission. This
 * one is read by whoever is packing boxes, and everything on it is arranged
 * around the one question they have: what still has to go out, and can it.
 *
 * Hence the differences. It sorts oldest first, because the oldest unbooked
 * order is the one the customer is about to telephone about. It shows the
 * address and the payment mode rather than the commission. And it is the only
 * screen in the affiliate CRM with a selection on it, because the work is done
 * forty parcels at a time.
 */

type Response = {
  items: SalesOrderRecord[];
  total: number;
  page: number;
  pages: number;
  summary: { revenue: number; commission: number };
  couriers: string[];
};

const BLANK = {
  q: "", processed: "no", delivery: "", payment: "", courier: "", rep: "", from: "", to: "", sort: "oldest"
};

export function ProcessScreen() {
  const [filters, setFilters] = useState(BLANK);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Response | null>(null);
  const [reps, setReps] = useState<SalesRepRecord[]>([]);
  const [options, setOptions] = useState<FulfilmentOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "warning" | "error" | "info"; text: string } | null>(null);
  /*
   * The selection is kept as whole orders rather than ids, so it survives paging
   * — a batch of sixty is picked across two pages and then processed once, and
   * the dialog needs each order's address to say which of them cannot go.
   */
  const [selected, setSelected] = useState<Record<string, SalesOrderRecord>>({});
  const [processing, setProcessing] = useState<SalesOrderRecord[] | null>(null);

  const load = useCallback(async () => {
    const search = new URLSearchParams({ page: String(page), limit: "50", sort: filters.sort });
    for (const key of ["q", "processed", "delivery", "payment", "courier", "rep", "from", "to"] as const) {
      if (filters[key]) search.set(key, filters[key]);
    }

    const response = await fetch(`/api/sales/orders?${search}`);
    const json = await response.json() as { data?: Response };
    setData(json.data ?? null);
    setLoading(false);
  }, [filters, page]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetch("/api/sales/reps")
      .then(response => response.json())
      .then((json: { data?: { reps: SalesRepRecord[] } }) => setReps(json.data?.reps ?? []))
      .catch(() => setReps([]));

    fetch("/api/sales/fulfilment/options")
      .then(response => response.json())
      .then((json: { data?: FulfilmentOptions }) => setOptions(json.data ?? null))
      .catch(() => setOptions(null));
  }, []);

  const set = (key: keyof typeof filters) => (value: string) => {
    setPage(1);
    setFilters(current => ({ ...current, [key]: value }));
  };

  const chosen = useMemo(() => Object.values(selected), [selected]);
  const items = data?.items ?? [];
  const allOnPageChosen = items.length > 0 && items.every(order => selected[order._id]);

  function toggle(order: SalesOrderRecord) {
    setSelected(current => {
      const next = { ...current };
      if (next[order._id]) delete next[order._id];
      else next[order._id] = order;
      return next;
    });
  }

  function togglePage() {
    setSelected(current => {
      const next = { ...current };
      for (const order of items) {
        if (allOnPageChosen) delete next[order._id];
        else next[order._id] = order;
      }
      return next;
    });
  }

  async function download(kind: "invoice" | "label", orders: SalesOrderRecord[]) {
    setBusy(true);
    const outcome = await downloadDocuments(kind, orders.map(order => order._id));
    setNotice({ tone: outcome.ok ? "info" : "error", text: outcome.message });
    setBusy(false);
  }

  return <div className="space-y-5">
    <PageTitle title="Process orders" subtitle="Book the parcel, choose the courier and print the paperwork"
      actions={<SyncButton tone="secondary" onDone={report => {
        setNotice(report.warnings.length
          ? { tone: "warning", text: `${report.message}. ${report.warnings.join(" ")}` }
          : { tone: "success", text: report.message });
        load();
      }} />} />

    {options?.refusal && <Notice tone="error">{options.refusal}</Notice>}
    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

    <Card className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Search">
        <input className="input" value={filters.q} placeholder="Order, coupon or customer"
          onChange={event => set("q")(event.target.value)} />
      </Field>
      <Field label="Processing">
        <select className="select" value={filters.processed} onChange={event => set("processed")(event.target.value)}>
          <option value="">Any</option>
          <option value="no">Not processed</option>
          <option value="booked">In Shiprocket, no airway bill</option>
          <option value="yes">Booked with a courier</option>
          <option value="failed">Last attempt failed</option>
        </select>
      </Field>
      <Field label="Payment">
        <select className="select" value={filters.payment} onChange={event => set("payment")(event.target.value)}>
          <option value="">Any</option>
          <option value="COD">Cash on delivery</option>
          <option value="Prepaid">Prepaid</option>
        </select>
      </Field>
      <Field label="Delivery">
        <select className="select" value={filters.delivery} onChange={event => set("delivery")(event.target.value)}>
          <option value="">Any</option>
          {DELIVERY_STATES.map(state => <option key={state} value={state}>{state}</option>)}
        </select>
      </Field>
      <Field label="Courier">
        <select className="select" value={filters.courier} onChange={event => set("courier")(event.target.value)}>
          <option value="">Any</option>
          {(data?.couriers ?? []).map(courier => <option key={courier} value={courier}>{courier}</option>)}
        </select>
      </Field>
      <Field label="Partner">
        <select className="select" value={filters.rep} onChange={event => set("rep")(event.target.value)}>
          <option value="">Everybody</option>
          {reps.map(rep => <option key={String(rep._id)} value={String(rep._id)}>{rep.name} ({rep.code})</option>)}
        </select>
      </Field>
      <Field label="Placed from">
        <input className="input" type="date" value={filters.from} onChange={event => set("from")(event.target.value)} />
      </Field>
      <Field label="Placed to">
        <input className="input" type="date" value={filters.to} onChange={event => set("to")(event.target.value)} />
      </Field>
      <Field label="Order">
        <select className="select" value={filters.sort} onChange={event => set("sort")(event.target.value)}>
          <option value="oldest">Oldest first</option>
          <option value="newest">Newest first</option>
        </select>
      </Field>
      <div className="flex items-end">
        <Button tone="ghost" onClick={() => { setFilters(BLANK); setPage(1); }}>Clear filters</Button>
      </div>
    </Card>

    {loading ? <Spinner label="Loading orders…" /> : data ? <>
      <Card className="grid grid-cols-2 gap-5 p-5 lg:grid-cols-4">
        <Stat label="Orders matching" value={data.total} />
        <Stat label="Value" value={formatRupees(data.summary.revenue)} />
        <Stat label="Selected" value={chosen.length} />
        <Stat label="On this page" value={items.length} />
      </Card>

      {chosen.length > 0 && (
        /* Pinned, because a selection made at the bottom of fifty rows is acted
           on without scrolling back to the top to find the button. */
        <div className="sticky top-16 z-10 flex flex-wrap items-center gap-2 rounded-[10px] border border-[var(--brand)] bg-[var(--surface)] px-4 py-3 shadow-sm lg:top-2">
          <span className="text-sm font-semibold">{orderCount(chosen.length)} selected</span>
          <span className="flex-1" />
          <Button tone="secondary" busy={busy} onClick={() => download("invoice", chosen)}><Download size={16} />Invoices</Button>
          <Button tone="secondary" busy={busy} onClick={() => download("label", chosen)}><Tag size={16} />Labels</Button>
          <Button onClick={() => setProcessing(chosen)} disabled={!options || Boolean(options.refusal)}>
            <Truck size={16} />Process
          </Button>
          <Button tone="ghost" onClick={() => setSelected({})}>Clear</Button>
        </div>
      )}

      {!items.length ? (
        <EmptyState icon={PackageSearch} title="Nothing to process here"
          description="Every order matching these filters has been dealt with. Widen the filters, or run a sync to pull in what has come in since." />
      ) : (
        <Card className="divide-y divide-[var(--line)]">
          <label className="flex items-center gap-3 px-5 py-3 text-sm font-medium">
            <input type="checkbox" checked={allOnPageChosen} onChange={togglePage} />
            Select the {items.length} on this page
          </label>

          {items.map(order => (
            <OrderRow key={order._id} order={order} chosen={Boolean(selected[order._id])}
              onToggle={() => toggle(order)}
              onProcess={() => setProcessing([order])}
              onDownload={kind => download(kind, [order])}
              mayProcess={Boolean(options && !options.refusal)} />
          ))}
        </Card>
      )}

      {data.pages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <button className="tap px-3 text-[var(--brand)] disabled:text-[var(--muted)]" disabled={page <= 1}
            onClick={() => setPage(current => current - 1)}>Previous</button>
          <span className="text-[var(--muted)]">Page {data.page} of {data.pages}</span>
          <button className="tap px-3 text-[var(--brand)] disabled:text-[var(--muted)]" disabled={page >= data.pages}
            onClick={() => setPage(current => current + 1)}>Next</button>
        </div>
      )}
    </> : <Notice tone="error">Could not load orders.</Notice>}

    {processing && options && <ProcessDialog orders={processing} options={options}
      onClose={() => setProcessing(null)}
      onDone={() => { setSelected({}); load(); }} />}
  </div>;
}

/** One order, as somebody about to pack it needs to see it. */
function OrderRow({ order, chosen, mayProcess, onToggle, onProcess, onDownload }: {
  order: SalesOrderRecord;
  chosen: boolean;
  mayProcess: boolean;
  onToggle: () => void;
  onProcess: () => void;
  onDownload: (kind: "invoice" | "label") => void;
}) {
  const state = processStateOf(order);
  const cod = paymentModeOf(order) === "COD";
  const address = addressOf(order);
  const missing = missingFields(address);
  const blocked = blockedReason(order);
  const booked = Boolean(order.shipment?.awb);

  return <div className="flex flex-wrap items-start gap-3 px-5 py-4">
    <input type="checkbox" className="mt-1.5" checked={chosen} onChange={onToggle} aria-label={`Select ${order.name}`} />

    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold">{order.name}</p>
        <Badge tone={processTone(state)}>{state}</Badge>
        <Badge tone={deliveryTone(order.delivery.state)}>{order.delivery.state}</Badge>
        <Badge tone={cod ? "warn" : "neutral"}>{cod ? `COD ${formatRupees(order.totals.paid)}` : "Prepaid"}</Badge>
      </div>

      <p className="mt-0.5 text-xs text-[var(--muted)]">
        {formatDate(order.placedAt)}
        {order.couponCode ? ` · ${order.couponCode}` : ""}
        {address.name ? ` · ${address.name}` : ""}
        {address.city ? ` · ${address.city}` : ""}
        {address.pinCode ? ` ${address.pinCode}` : ""}
      </p>

      <p className="mt-0.5 text-xs text-[var(--muted)]">
        {order.items.map(item => `${item.title}${item.quantity > 1 ? ` ×${item.quantity}` : ""}`).join(", ")}
      </p>

      {booked && (
        <p className="mt-1 text-xs font-medium text-[var(--ok-ink)]">
          {order.shipment?.courier || "Courier"} · AWB {order.shipment?.awb}
          {order.shipment?.pickupScheduledAt ? ` · pickup ${formatDate(order.shipment.pickupScheduledAt)}` : ""}
        </p>
      )}

      {/* The reason it cannot go, said on the row rather than only when somebody
          tries — that is what lets a picking list be scanned for the exceptions. */}
      {!booked && (blocked || missing.length > 0) && (
        <p className="mt-1 flex items-start gap-1 text-xs text-[var(--warn-ink)]">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          {blocked ?? `Needs the ${missing.join(", ")} before it can be booked.`}
        </p>
      )}

      {order.shipment?.lastError && !booked && (
        <p className="mt-1 text-xs text-[var(--danger-ink)]">Last attempt: {order.shipment.lastError}</p>
      )}
    </div>

    <div className="flex shrink-0 flex-wrap items-center gap-3 text-xs font-medium">
      {order.shipment?.shiprocketOrderId && (
        <button className="text-[var(--brand)] hover:underline" onClick={() => onDownload("invoice")}>Invoice</button>
      )}
      {booked && (
        <button className="text-[var(--brand)] hover:underline" onClick={() => onDownload("label")}>Label</button>
      )}
      {/*
        * No button on an order that already carries an airway bill. Booking it
        * again is two parcels, two freights and one customer — the row shows
        * what it went out on instead.
        */}
      {!blocked && mayProcess && (
        <Button tone="secondary" className="min-h-[36px] px-3 text-xs" onClick={onProcess}>
          <Truck size={14} />Process
        </Button>
      )}
    </div>
  </div>;
}
