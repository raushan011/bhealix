"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Upload } from "lucide-react";
import { Button, Card, Field, Notice, PageTitle, Spinner, Stat } from "@/components/ui/kit";
import { ImportOrders } from "@/components/sales/import-orders";
import { OrderList } from "@/components/sales/order-list";
import { SyncButton } from "@/components/sales/sync-button";
import { COMMISSION_STATUSES, DELIVERY_STATES } from "@/lib/sales/constants";
import { formatRupees, type SalesOrderRecord, type SalesRepRecord } from "@/lib/sales/types";

type Response = {
  items: SalesOrderRecord[];
  total: number;
  page: number;
  pages: number;
  summary: { revenue: number; commission: number };
  mayPay?: boolean;
};

function OrdersScreen() {
  const params = useSearchParams();
  const [filters, setFilters] = useState({
    q: "",
    rep: "",
    // Deep-linked from the coupons screen, so "which orders did this code bring
    // in" is one click from the code rather than a search somebody composes.
    coupon: params.get("coupon") ?? "",
    delivery: "",
    status: "",
    attention: params.get("attention") === "1"
  });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Response | null>(null);
  const [reps, setReps] = useState<SalesRepRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "warning" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    const search = new URLSearchParams({ page: String(page), limit: "50" });
    if (filters.q) search.set("q", filters.q);
    if (filters.rep) search.set("rep", filters.rep);
    if (filters.coupon) search.set("coupon", filters.coupon);
    if (filters.delivery) search.set("delivery", filters.delivery);
    if (filters.status) search.set("status", filters.status);
    if (filters.attention) search.set("attention", "1");

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
  }, []);

  const set = (key: keyof typeof filters) => (value: string | boolean) => {
    setPage(1);
    setFilters(current => ({ ...current, [key]: value }));
  };

  return <div className="space-y-5">
    <PageTitle title="Orders" subtitle="Every order a partner's coupon brought in"
      actions={<>
        <Button tone="secondary" onClick={() => setImporting(true)}><Upload size={16} />Import file</Button>
        <SyncButton tone="secondary" onDone={report => {
          if (report.warnings.length && !report.message) setNotice({ tone: "error", text: report.warnings[0] });
          else if (report.warnings.length) setNotice({ tone: "warning", text: `${report.message}. ${report.warnings.join(" ")}` });
          else setNotice({ tone: "success", text: report.message });
          load();
        }} />
      </>} />

    {importing && <ImportOrders onClose={() => setImporting(false)}
      onDone={message => { setImporting(false); setNotice({ tone: "success", text: message }); load(); }} />}

    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

    {filters.attention && (
      <Notice tone="warning">
        Showing only orders whose commission was paid and whose parcel then came back. Nothing has been
        reversed automatically — these need a decision.
      </Notice>
    )}

    {filters.coupon && (
      <Notice tone="info">
        Showing only orders that came in on <strong>{filters.coupon}</strong>.{" "}
        <button className="underline" onClick={() => set("coupon")("")}>Show every code</button>
      </Notice>
    )}

    <Card className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-5">
      <Field label="Search">
        <input className="input" value={filters.q} placeholder="Order, coupon or customer"
          onChange={event => set("q")(event.target.value)} />
      </Field>
      <Field label="Partner">
        <select className="select" value={filters.rep} onChange={event => set("rep")(event.target.value)}>
          <option value="">Everybody</option>
          {reps.map(rep => <option key={String(rep._id)} value={String(rep._id)}>{rep.name} ({rep.code})</option>)}
        </select>
      </Field>
      {/*
        * Every code held by anybody, so the commonest question on this screen —
        * "what did PRIYA30 bring in" — is a dropdown rather than a search whose
        * spelling has to be right.
        */}
      <Field label="Coupon">
        <select className="select" value={filters.coupon} onChange={event => set("coupon")(event.target.value)}>
          <option value="">Any code</option>
          {reps.flatMap(rep => (rep.coupons ?? []).map(coupon => (
            <option key={coupon.code} value={coupon.code}>{coupon.code} — {rep.name}</option>
          )))}
        </select>
      </Field>
      <Field label="Delivery">
        <select className="select" value={filters.delivery} onChange={event => set("delivery")(event.target.value)}>
          <option value="">Any</option>
          {DELIVERY_STATES.map(state => <option key={state} value={state}>{state}</option>)}
        </select>
      </Field>
      <Field label="Commission">
        <select className="select" value={filters.status} onChange={event => set("status")(event.target.value)}>
          <option value="">Any</option>
          {COMMISSION_STATUSES.map(status => <option key={status} value={status}>{status}</option>)}
        </select>
      </Field>
    </Card>

    {loading ? <Spinner label="Loading orders…" /> : data ? <>
      <Card className="grid grid-cols-2 gap-5 p-5 lg:grid-cols-3">
        <Stat label="Orders matching" value={data.total} />
        <Stat label="Revenue" value={formatRupees(data.summary.revenue)} />
        <Stat label="Commission" value={formatRupees(data.summary.commission)} />
      </Card>

      <OrderList orders={data.items} mayOverride mayPay={data.mayPay ?? false} onChanged={load} />

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
  </div>;
}

export default function SalesOrdersPage() {
  // `useSearchParams` needs a boundary, and the ?attention=1 link from the
  // dashboard is what puts one there.
  return <Suspense fallback={<Spinner label="Loading orders…" />}><OrdersScreen /></Suspense>;
}
