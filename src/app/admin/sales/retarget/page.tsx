"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, RotateCcw, SlidersHorizontal } from "lucide-react";
import { Button, Card, Field, Notice, PageTitle, Spinner, Stat } from "@/components/ui/kit";
import { RetargetList } from "@/components/sales/retarget-list";
import { SyncButton } from "@/components/sales/sync-button";
import { DELIVERY_STATES } from "@/lib/sales/constants";
import { REMARK_CHANNELS } from "@/lib/sales/leads";
import { FULFILMENT_STATES, RETARGET_SORTS, RETARGET_STATUSES } from "@/lib/sales/retarget";
import type { SalesRepRecord, ShopOrderRecord } from "@/lib/sales/types";

type Payload = {
  items: ShopOrderRecord[];
  total: number;
  page: number;
  pages: number;
  statuses: Record<string, number>;
  followUpsDue: number;
  facets: { cities: string[]; products: string[]; months: string[] };
  mayEdit: boolean;
};

const EMPTY = {
  q: "", month: "", from: "", to: "",
  status: "", delivery: "", fulfilment: "", payment: "", cancelled: "",
  city: "", product: "", partner: "", coupon: "",
  repeat: "", remarks: "", channel: "", contacted: "", contactedBefore: "", followUp: "",
  minTotal: "", maxTotal: "", sort: "newest"
};
type Filters = typeof EMPTY;

const monthLabel = (month: string) => {
  const [year, mm] = month.split("-").map(Number);
  return new Date(year, mm - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
};

/**
 * Every Shopify order the shop has taken, as a calling list.
 *
 * The filters are the screen. A calling desk works a *slice* — "everybody who
 * bought the kit in May, delivered, not yet rung" — and then works the next
 * slice; the list without a way to cut it is a phone book. Every filter is
 * sent to the server, so the count, the page and the export all agree.
 */
export default function RetargetPage() {
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Payload | null>(null);
  const [reps, setReps] = useState<SalesRepRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "warning" | "error"; text: string } | null>(null);

  const query = useMemo(() => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value) search.set(key, value);
    return search;
  }, [filters]);

  const load = useCallback(async () => {
    const search = new URLSearchParams(query);
    search.set("page", String(page));
    search.set("limit", "50");
    const response = await fetch(`/api/sales/retarget?${search}`);
    const json = await response.json() as { data?: Payload };
    setData(json.data ?? null);
    setLoading(false);
  }, [query, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch("/api/sales/reps").then(response => response.json())
      .then((json: { data?: { reps: SalesRepRecord[] } }) => setReps(json.data?.reps ?? []))
      .catch(() => setReps([]));
  }, []);

  const set = (key: keyof Filters) => (value: string) => {
    setPage(1);
    setFilters(current => {
      const next = { ...current, [key]: value };
      // A month and a date range answer the same question; picking one clears the other.
      if (key === "month" && value) { next.from = ""; next.to = ""; }
      if ((key === "from" || key === "to") && value) next.month = "";
      return next;
    });
  };

  const active = Object.entries(filters).filter(([key, value]) => value && !(key === "sort" && value === "newest")).length;
  const statuses = data?.statuses ?? {};

  return <div className="space-y-5">
    <PageTitle title="Retarget" subtitle="Every order the shop has taken — ring the customer, and write down what they said"
      actions={<>
        <a href={`/api/sales/retarget/export?${query}`} className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-[10px] border border-[var(--line-2)] bg-[var(--surface)] px-4 text-sm font-semibold hover:bg-[var(--surface-2)]">
          <Download size={16} />Export
        </a>
        {/*
          * The ordinary sync is incremental and only reads what changed since
          * the last one. The first time this screen is opened the customer base
          * is whatever the last ninety days of syncs happened to touch — so a
          * button that reaches back over the shop's whole history is what fills
          * the list. Two years is Shopify's own limit on a plain orders pull.
          */}
        <SyncButton tone="secondary" full sinceDays={730} label="Pull all history" onDone={report => {
          if (report.warnings.length && !report.message) setNotice({ tone: "error", text: report.warnings[0] });
          else if (report.warnings.length) setNotice({ tone: "warning", text: `${report.message}. ${report.warnings.join(" ")}` });
          else setNotice({ tone: "success", text: report.message });
          load();
        }} />
        <SyncButton onDone={report => {
          if (report.warnings.length && !report.message) setNotice({ tone: "error", text: report.warnings[0] });
          else if (report.warnings.length) setNotice({ tone: "warning", text: `${report.message}. ${report.warnings.join(" ")}` });
          else setNotice({ tone: "success", text: report.message });
          load();
        }} />
      </>} />

    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

    {/* One tap per status, because "show me everybody I have not rung" is the question nine times in ten. */}
    <div className="flex flex-wrap gap-1.5">
      <Chip active={!filters.status && !filters.followUp} onClick={() => { set("status")(""); set("followUp")(""); }}>All {data ? `(${data.total})` : ""}</Chip>
      {RETARGET_STATUSES.map(status => (
        <Chip key={status} active={filters.status === status} onClick={() => set("status")(filters.status === status ? "" : status)}>
          {status} {statuses[status] !== undefined ? `(${statuses[status]})` : ""}
        </Chip>
      ))}
      <Chip active={filters.followUp === "due"} tone="warn" onClick={() => set("followUp")(filters.followUp === "due" ? "" : "due")}>
        Follow-ups due {data ? `(${data.followUpsDue})` : ""}
      </Chip>
    </div>

    <Card className="space-y-4 p-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Search">
          <input className="input" value={filters.q} placeholder="Name, phone, email, order or city" onChange={event => set("q")(event.target.value)} />
        </Field>
        <Field label="Month">
          <select className="select" value={filters.month} onChange={event => set("month")(event.target.value)}>
            <option value="">Any month</option>
            {(data?.facets.months ?? []).map(month => <option key={month} value={month}>{monthLabel(month)}</option>)}
          </select>
        </Field>
        <Field label="Ordered from">
          <input className="input" type="date" value={filters.from} onChange={event => set("from")(event.target.value)} />
        </Field>
        <Field label="Ordered to">
          <input className="input" type="date" value={filters.to} onChange={event => set("to")(event.target.value)} />
        </Field>
        <Field label="Delivery">
          <select className="select" value={filters.delivery} onChange={event => set("delivery")(event.target.value)}>
            <option value="">Any</option>
            {DELIVERY_STATES.map(state => <option key={state} value={state}>{state}</option>)}
            <option value="Untracked">Not tracked by Shiprocket</option>
          </select>
        </Field>
        <Field label="Product">
          <select className="select" value={filters.product} onChange={event => set("product")(event.target.value)}>
            <option value="">Any product</option>
            {(data?.facets.products ?? []).map(product => <option key={product} value={product}>{product}</option>)}
          </select>
        </Field>
        <Field label="Remarks">
          <select className="select" value={filters.remarks} onChange={event => set("remarks")(event.target.value)}>
            <option value="">Any</option>
            <option value="none">Nothing written yet</option>
            <option value="any">Has remarks</option>
          </select>
        </Field>
        <Field label="Sort">
          <select className="select" value={filters.sort} onChange={event => set("sort")(event.target.value)}>
            {RETARGET_SORTS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Field>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={() => setMore(current => !current)}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--brand)] hover:underline">
          <SlidersHorizontal size={14} />{more ? "Fewer filters" : "More filters"}
        </button>
        {active > 0 && (
          <button type="button" onClick={() => { setPage(1); setFilters(EMPTY); }}
            className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:underline">
            <RotateCcw size={13} />Clear {active} filter{active === 1 ? "" : "s"}
          </button>
        )}
      </div>

      {more && (
        <div className="grid gap-4 border-t border-[var(--line)] pt-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="City">
            <select className="select" value={filters.city} onChange={event => set("city")(event.target.value)}>
              <option value="">Any city</option>
              {(data?.facets.cities ?? []).map(city => <option key={city} value={city}>{city}</option>)}
            </select>
          </Field>
          <Field label="Shopify fulfilment">
            <select className="select" value={filters.fulfilment} onChange={event => set("fulfilment")(event.target.value)}>
              <option value="">Any</option>
              {FULFILMENT_STATES.map(state => <option key={state} value={state}>{state}</option>)}
            </select>
          </Field>
          <Field label="Payment">
            <select className="select" value={filters.payment} onChange={event => set("payment")(event.target.value)}>
              <option value="">Any</option>
              <option value="COD">Cash on delivery</option>
              <option value="Prepaid">Prepaid</option>
            </select>
          </Field>
          <Field label="Cancelled">
            <select className="select" value={filters.cancelled} onChange={event => set("cancelled")(event.target.value)}>
              <option value="">Any</option>
              <option value="no">Not cancelled</option>
              <option value="yes">Cancelled</option>
            </select>
          </Field>
          <Field label="Partner">
            <select className="select" value={filters.partner} onChange={event => set("partner")(event.target.value)}>
              <option value="">Any</option>
              <option value="none">No partner — the shop&rsquo;s own</option>
              <option value="any">Any partner&rsquo;s coupon</option>
              {reps.map(rep => <option key={String(rep._id)} value={String(rep._id)}>{rep.name} ({rep.code})</option>)}
            </select>
          </Field>
          <Field label="Coupon code">
            <input className="input" value={filters.coupon} placeholder="Exact code" onChange={event => set("coupon")(event.target.value)} />
          </Field>
          <Field label="Customer">
            <select className="select" value={filters.repeat} onChange={event => set("repeat")(event.target.value)}>
              <option value="">Any</option>
              <option value="yes">Repeat — 2 or more orders</option>
              <option value="no">First order only</option>
            </select>
          </Field>
          <Field label="Last remark filed under">
            <select className="select" value={filters.channel} onChange={event => set("channel")(event.target.value)}>
              <option value="">Any</option>
              {REMARK_CHANNELS.map(channel => <option key={channel} value={channel}>{channel}</option>)}
            </select>
          </Field>
          <Field label="Contacted">
            <select className="select" value={filters.contacted} onChange={event => set("contacted")(event.target.value)}>
              <option value="">Any</option>
              <option value="never">Never contacted</option>
              <option value="ever">Contacted at least once</option>
            </select>
          </Field>
          <Field label="Not contacted since" hint="Never, or last before this day.">
            <input className="input" type="date" value={filters.contactedBefore} onChange={event => set("contactedBefore")(event.target.value)} />
          </Field>
          <Field label="Follow-up">
            <select className="select" value={filters.followUp} onChange={event => set("followUp")(event.target.value)}>
              <option value="">Any</option>
              <option value="due">Due now</option>
              <option value="upcoming">Set for later</option>
              <option value="none">None set</option>
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Amount from">
              <input className="input" type="number" min={0} value={filters.minTotal} onChange={event => set("minTotal")(event.target.value)} />
            </Field>
            <Field label="to">
              <input className="input" type="number" min={0} value={filters.maxTotal} onChange={event => set("maxTotal")(event.target.value)} />
            </Field>
          </div>
        </div>
      )}
    </Card>

    {loading ? <Spinner label="Loading orders…" /> : data ? <>
      <Card className="grid grid-cols-2 gap-5 p-5 lg:grid-cols-4">
        <Stat label="Orders matching" value={data.total} />
        <Stat label="Not called yet" value={statuses["Not called"] ?? 0} />
        <Stat label="Interested / call back" value={(statuses["Interested"] ?? 0) + (statuses["Call back"] ?? 0)} tone="text-[var(--ok-ink)]" />
        <Stat label="Reordered" value={statuses["Reordered"] ?? 0} tone="text-[var(--ok-ink)]" />
      </Card>

      {!data.mayEdit && <Notice>You can read the list and the remarks. Recording a call needs the calling desk&rsquo;s access.</Notice>}

      <RetargetList orders={data.items} mayEdit={data.mayEdit} onChanged={load} />

      {data.pages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <Button tone="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="text-[var(--muted)]">Page {data.page} of {data.pages} · {data.total} orders</span>
          <Button tone="secondary" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </> : <Notice tone="error">Could not load the orders.</Notice>}
  </div>;
}

function Chip({ active, tone, onClick, children }: { active: boolean; tone?: "warn"; onClick: () => void; children: React.ReactNode }) {
  const on = tone === "warn"
    ? "border-[var(--warn-line)] bg-[var(--warn-bg)] text-[var(--warn-ink)]"
    : "border-[var(--brand)] bg-[var(--brand)] text-[var(--on-brand)]";
  return <button type="button" onClick={onClick} aria-pressed={active}
    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${active ? on : "border-[var(--line-2)] text-[var(--ink-2)] hover:bg-[var(--surface-2)]"}`}>
    {children}
  </button>;
}
