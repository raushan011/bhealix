"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, MessageCircle, Phone, ShoppingBag, UserRoundSearch } from "lucide-react";
import { Badge, Button, Card, EmptyState, Field, Notice, Spinner } from "@/components/ui/kit";
import { Modal } from "@/components/ui/modal";
import {
  LEAD_STATUSES, REMARK_CHANNELS, REMARK_PRESETS, leadTone, remarkTone, telUrl, whatsappUrl,
  type LeadStatus, type RemarkChannel
} from "@/lib/sales/leads";
import { formatRupees, PAYMENT_MODE_LABEL, type TeamPaymentMode } from "@/lib/sales-team/orders";
import { formatDate, formatDateTime } from "@/lib/time";
import { call, messageOf } from "./shared";

type Lead = {
  _id: string; name: string; type: string; status: LeadStatus; phone?: string; address?: string; area?: string; city?: string;
  notes?: string; googleMapsUrl?: string; lastContactedAt?: string; contactCount?: number; assignedAt?: string;
};
type Page = { items: Lead[]; total: number; page: number; pages: number; counts: Partial<Record<LeadStatus, number>> };
type Remark = { _id: string; text: string; channel: RemarkChannel; status?: LeadStatus; at: string; byName?: string };
type Detail = {
  lead: Lead & { remarks: Remark[] };
  orders: Array<{ _id: string; name: string; placedAt: string; totals: { paid: number }; paymentMode: TeamPaymentMode; delivery: { state: string }; cancelledAt?: string }>;
};

/**
 * The leads handed to one executive, to be worked.
 *
 * Untouched leads come first, then whoever has waited longest since the last
 * word. Opening one shows everything said to it so far — including by whoever
 * held it before — and the two things a call ends in: a remark, or an order.
 */
export function LeadDesk({ orderPath }: { orderPath: string }) {
  const [status, setStatus] = useState<string>("open");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const query = new URLSearchParams({ page: String(page), limit: "25" });
    if (status === "open") query.set("open", "1"); else if (status) query.set("status", status);
    if (q) query.set("q", q);
    try { setData(await call<Page>(`/api/sales-team/leads?${query}`)); setError(""); } catch (problem) { setError(messageOf(problem)); }
  }, [status, q, page]);
  useEffect(() => { const timer = setTimeout(load, 250); return () => clearTimeout(timer); }, [load]);

  const total = Object.values(data?.counts ?? {}).reduce((sum, count) => sum + (count ?? 0), 0);
  const openCount = total - (data?.counts.Converted ?? 0) - (data?.counts["Not interested"] ?? 0);

  return <div className="space-y-4">
    <div className="flex flex-wrap gap-2">
      {[{ value: "open", label: `To work (${openCount})` }, ...LEAD_STATUSES.map(value => ({ value, label: `${value} (${data?.counts[value] ?? 0})` })), { value: "", label: `All (${total})` }].map(option => (
        <button key={option.value || "all"} onClick={() => { setStatus(option.value); setPage(1); }}
          className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${status === option.value ? "border-[var(--brand)] bg-[var(--brand)] text-[var(--on-brand)]" : "border-[var(--line-2)] text-[var(--ink-2)] hover:bg-[var(--surface-2)]"}`}>
          {option.label}
        </button>
      ))}
    </div>
    <input className="input" placeholder="Search by name, phone, area or city" value={q} onChange={event => { setQ(event.target.value); setPage(1); }} />

    {error && <Notice tone="error">{error}</Notice>}
    {!data && !error && <Spinner label="Loading your leads…" />}
    {data && !data.items.length && (
      <EmptyState icon={UserRoundSearch} title="No leads here" description={total ? "Nothing in this tab." : "No leads have been assigned to you yet. Your manager hands them out from the Sales CRM."} />
    )}

    {data && data.items.length > 0 && (
      <Card className="divide-y divide-[var(--line)]">
        {data.items.map(lead => (
          <div key={lead._id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
            <button onClick={() => setOpen(lead._id)} className="min-w-0 flex-1 text-left">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">{lead.name}</span>
                <Badge tone={leadTone(lead.status)}>{lead.status}</Badge>
                <span className="text-xs text-[var(--muted)]">{lead.type}</span>
              </div>
              <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
                {[lead.area, lead.city].filter(Boolean).join(", ")}
                {lead.lastContactedAt ? ` · last contacted ${formatDate(lead.lastContactedAt)}` : " · not contacted yet"}
                {lead.contactCount ? ` · ${lead.contactCount}×` : ""}
              </p>
            </button>
            <div className="flex items-center gap-1">
              {telUrl(lead.phone) && <a href={telUrl(lead.phone)!} aria-label={`Call ${lead.name}`} className="tap grid place-items-center rounded-[10px] text-[var(--brand)] hover:bg-[var(--surface-2)]"><Phone size={17} /></a>}
              {whatsappUrl(lead.phone) && <a href={whatsappUrl(lead.phone)!} target="_blank" rel="noreferrer" aria-label={`WhatsApp ${lead.name}`} className="tap grid place-items-center rounded-[10px] text-[var(--ok-ink)] hover:bg-[var(--surface-2)]"><MessageCircle size={17} /></a>}
              {lead.status !== "Converted" && <Link href={`${orderPath}/new?lead=${lead._id}`} className="tap inline-flex items-center gap-1.5 rounded-[10px] border border-[var(--line-2)] px-3 text-xs font-semibold hover:bg-[var(--surface-2)]"><ShoppingBag size={14} />Order</Link>}
            </div>
          </div>
        ))}
      </Card>
    )}

    {data && data.pages > 1 && (
      <div className="flex items-center justify-center gap-3 text-sm">
        <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="tap grid place-items-center rounded-[10px] disabled:opacity-30" aria-label="Previous page"><ChevronLeft size={18} /></button>
        <span>Page {data.page} of {data.pages}</span>
        <button disabled={page >= data.pages} onClick={() => setPage(page + 1)} className="tap grid place-items-center rounded-[10px] disabled:opacity-30" aria-label="Next page"><ChevronRight size={18} /></button>
      </div>
    )}

    {open && <LeadDialog id={open} orderPath={orderPath} onClose={() => setOpen(null)} onChanged={load} />}
  </div>;
}

function LeadDialog({ id, orderPath, onClose, onChanged }: { id: string; orderPath: string; onClose: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [text, setText] = useState("");
  const [channel, setChannel] = useState<RemarkChannel>("Call");
  const [status, setStatus] = useState<LeadStatus | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try { setDetail(await call<Detail>(`/api/sales-team/leads/${id}`)); } catch (problem) { setError(messageOf(problem)); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function save() {
    setBusy(true); setError("");
    try {
      await call(`/api/sales-team/leads/${id}`, { body: { text, channel, status: status || undefined } });
      setText(""); setStatus("");
      await load();
      onChanged();
    } catch (problem) { setError(messageOf(problem)); } finally { setBusy(false); }
  }

  const lead = detail?.lead;
  return <Modal title={lead?.name ?? "Lead"} description={lead ? `${lead.type}${lead.city ? ` · ${lead.city}` : ""}` : undefined} onClose={onClose}
    footer={lead && lead.status !== "Converted" ? <Link href={`${orderPath}/new?lead=${id}`} className="tap flex w-full items-center justify-center gap-2 rounded-[10px] bg-[var(--brand)] text-sm font-semibold text-[var(--on-brand)]"><ShoppingBag size={16} />Place an order for this lead</Link> : undefined}>
    {!detail ? (error ? <Notice tone="error">{error}</Notice> : <Spinner label="Loading…" />) : <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={leadTone(detail.lead.status)}>{detail.lead.status}</Badge>
        {detail.lead.phone && <a href={telUrl(detail.lead.phone) ?? "#"} className="text-sm text-[var(--brand)]">{detail.lead.phone}</a>}
        {detail.lead.googleMapsUrl && <a href={detail.lead.googleMapsUrl} target="_blank" rel="noreferrer" className="text-xs text-[var(--brand)] underline">Map</a>}
      </div>
      {detail.lead.address && <p className="text-sm text-[var(--ink-2)]">{detail.lead.address}</p>}
      {detail.lead.notes && <Notice>{detail.lead.notes}</Notice>}

      {detail.orders.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Orders</p>
          {detail.orders.map(order => (
            <Link key={order._id} href={`${orderPath}/${order._id}`} className="flex items-center justify-between rounded-[10px] border border-[var(--line)] px-3 py-2 text-sm hover:bg-[var(--surface-2)]">
              <span>{order.name} · {PAYMENT_MODE_LABEL[order.paymentMode]}</span>
              <span className="tabular-nums">{formatRupees(order.totals.paid)} · {order.cancelledAt ? "Cancelled" : order.delivery.state}</span>
            </Link>
          ))}
        </div>
      )}

      <div className="space-y-3 rounded-[12px] border border-[var(--line)] p-3">
        <div className="flex flex-wrap gap-1.5">
          {REMARK_PRESETS.map(preset => (
            <button key={preset.label} onClick={() => { setText(preset.text); if (preset.status) setStatus(preset.status); }}
              className="rounded-full border border-[var(--line-2)] px-2.5 py-1 text-xs hover:bg-[var(--surface-2)]">{preset.label}</button>
          ))}
        </div>
        <textarea className="textarea" rows={2} value={text} onChange={event => setText(event.target.value)} placeholder="How did it go?" />
        <div className="grid grid-cols-2 gap-2">
          <Field label="By">
            <select className="select" value={channel} onChange={event => setChannel(event.target.value as RemarkChannel)}>
              {REMARK_CHANNELS.map(value => <option key={value} value={value}>{value}</option>)}
            </select>
          </Field>
          <Field label="Lead is now">
            <select className="select" value={status} onChange={event => setStatus(event.target.value as LeadStatus | "")}>
              <option value="">Unchanged</option>
              {LEAD_STATUSES.filter(value => value !== "Converted").map(value => <option key={value} value={value}>{value}</option>)}
            </select>
          </Field>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        <Button className="w-full" busy={busy} disabled={text.trim().length < 2} onClick={save}>Save remark</Button>
      </div>

      <div className="space-y-2">
        {detail.lead.remarks.map(remark => (
          <div key={remark._id} className="rounded-[10px] bg-[var(--surface-2)] px-3 py-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
              <Badge tone={remarkTone(remark.channel)}>{remark.channel}</Badge>
              {remark.status && <Badge tone={leadTone(remark.status)}>{remark.status}</Badge>}
              <span>{formatDateTime(remark.at)}{remark.byName ? ` · ${remark.byName}` : ""}</span>
            </div>
            <p className="mt-1 text-sm">{remark.text}</p>
          </div>
        ))}
        {!detail.lead.remarks.length && <p className="text-sm text-[var(--muted)]">Nothing has been said to this lead yet.</p>}
      </div>
    </div>}
  </Modal>;
}
