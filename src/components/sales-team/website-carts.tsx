"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Phone, RefreshCw, ShoppingCart, UserPlus } from "lucide-react";
import { Badge, Button, Card, EmptyState, Notice, Spinner } from "@/components/ui/kit";
import { LEAD_STATUSES, leadTone, telUrl, type LeadStatus } from "@/lib/sales/leads";
import type { ExecutiveRow } from "@/lib/sales-team/website-leads";
import { formatDate } from "@/lib/time";
import { call, messageOf } from "./shared";
import { CartLine, LeadDialog } from "./lead-desk";

type Lead = {
  _id: string; name: string; status: LeadStatus; phone?: string;
  assignedTo?: { _id: string; name: string } | null; assignedAt?: string; lastContactedAt?: string; contactCount?: number; followUpAt?: string;
  cart?: { lastAt?: string; lastProduct?: string; lastSource?: string; count?: number };
};
type Page = { items: Lead[]; total: number; page: number; pages: number; counts: Partial<Record<LeadStatus, number>>; byExecutive?: ExecutiveRow[] };

/**
 * Website carts: shoppers who left their number at Add to cart on bhealix.com.
 *
 * The desk's view of them, in three parts. At the top, who holds how many and
 * where each stands — the tracking table, which is also a filter. Below it, the
 * carts themselves, newest first, to tick and hand to an executive. Opening one
 * shows what was carted and every remark since, so the desk can follow a lead
 * without asking the executive how it went.
 */
export function WebsiteCarts({ mayAssign }: { mayAssign: boolean }) {
  const [filters, setFilters] = useState({ assigned: "none", status: "", q: "" });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page | null>(null);
  const [executives, setExecutives] = useState<Array<{ _id: string; name: string }>>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  useEffect(() => { call<{ items: Array<{ _id: string; name: string }> }>("/api/sales-team/executives").then(result => setExecutives(result.items)).catch(() => undefined); }, []);

  const load = useCallback(async () => {
    const query = new URLSearchParams({ source: "Website", page: String(page), limit: "50" });
    for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
    try { setData(await call<Page>(`/api/sales-team/leads?${query}`)); } catch (problem) { setNotice({ tone: "error", text: messageOf(problem) }); }
  }, [filters, page]);
  useEffect(() => { const timer = setTimeout(load, 250); return () => clearTimeout(timer); }, [load]);

  const set = (key: keyof typeof filters, value: string) => { setPage(1); setSelected(new Set()); setFilters(current => ({ ...current, [key]: value })); };
  const toggle = (id: string) => setSelected(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const selectable = (data?.items ?? []).filter(lead => lead.status !== "Converted");

  async function assign(executive: string | null) {
    setBusy(true); setNotice(null);
    try {
      const result = await call<{ message: string }>("/api/sales-team/leads/assign", { body: { leadIds: [...selected], executive } });
      setNotice({ tone: "success", text: result.message });
      setSelected(new Set());
      await load();
    } catch (problem) { setNotice({ tone: "error", text: messageOf(problem) }); } finally { setBusy(false); }
  }

  const rows = data?.byExecutive ?? [];
  return <div className="space-y-4">
    {rows.length > 0 && (
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="text-left text-xs text-[var(--muted)]">
            <tr className="border-b border-[var(--line)]">
              <th className="px-4 py-2.5 font-semibold">Held by</th>
              <th className="px-3 py-2.5 text-right font-semibold">Total</th>
              {LEAD_STATUSES.map(status => <th key={status} className="px-3 py-2.5 text-right font-semibold">{status}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const value = row.executive ?? "none";
              return <tr key={value} onClick={() => set("assigned", filters.assigned === value ? "" : value)}
                className={`cursor-pointer border-b border-[var(--line)] last:border-0 hover:bg-[var(--surface-2)] ${filters.assigned === value ? "bg-[var(--surface-2)]" : ""}`}>
                <td className="px-4 py-2.5 font-semibold">{row.name}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{row.total}</td>
                {LEAD_STATUSES.map(status => <td key={status} className="px-3 py-2.5 text-right tabular-nums text-[var(--ink-2)]">{row.counts[status] || "–"}</td>)}
              </tr>;
            })}
          </tbody>
        </table>
      </Card>
    )}

    <Card className="grid gap-3 p-4 sm:grid-cols-[1fr_1fr_1.4fr_auto]">
      <select className="select" value={filters.assigned} onChange={event => set("assigned", event.target.value)} aria-label="Held by">
        <option value="none">Not assigned yet</option>
        <option value="any">Held by an executive</option>
        <option value="">Every website cart</option>
        {executives.map(person => <option key={person._id} value={person._id}>Held by {person.name}</option>)}
      </select>
      <select className="select" value={filters.status} onChange={event => set("status", event.target.value)} aria-label="Status">
        <option value="">Any status</option>
        {LEAD_STATUSES.map(value => <option key={value} value={value}>{value} ({data?.counts[value] ?? 0})</option>)}
      </select>
      <input className="input" placeholder="Name or phone" value={filters.q} onChange={event => set("q", event.target.value)} />
      <Button tone="secondary" onClick={load} aria-label="Refresh"><RefreshCw size={16} /></Button>
    </Card>

    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

    {mayAssign && (
      <Card className="flex flex-wrap items-center gap-3 p-4">
        <span className="text-sm font-semibold">{selected.size} selected</span>
        <button className="text-xs font-semibold text-[var(--brand)]" onClick={() => setSelected(new Set(selected.size === selectable.length ? [] : selectable.map(lead => lead._id)))}>
          {selected.size && selected.size === selectable.length ? "Clear" : "Select this page"}
        </button>
        <select className="select !w-auto min-w-[200px]" value={target} onChange={event => setTarget(event.target.value)} aria-label="Hand to">
          <option value="">Hand to…</option>
          {executives.map(person => <option key={person._id} value={person._id}>{person.name}</option>)}
        </select>
        <Button busy={busy} disabled={!selected.size || !target} onClick={() => assign(target)}><UserPlus size={16} />Assign</Button>
        <Button tone="secondary" disabled={!selected.size || busy} onClick={() => assign(null)}>Take back</Button>
        {!executives.length && <span className="text-xs text-[var(--warn-ink)]">No sales executives yet — add one under HR &amp; Employees.</span>}
      </Card>
    )}

    {!data && <Spinner label="Loading website carts…" />}
    {data && !data.items.length && (
      <EmptyState icon={ShoppingCart} title="No website carts here"
        description={filters.assigned === "none" ? "Every website cart has been handed out. New ones appear here the moment a shopper adds to cart." : "Nothing matches these filters."} />
    )}
    {data && data.items.length > 0 && (
      <Card className="divide-y divide-[var(--line)]">
        {data.items.map(lead => (
          <div key={lead._id} className="flex items-start gap-3 px-4 py-3 hover:bg-[var(--surface-2)] sm:px-5">
            {mayAssign && <input type="checkbox" className="mt-1" aria-label={`Select ${lead.name}`} disabled={lead.status === "Converted"} checked={selected.has(lead._id)} onChange={() => toggle(lead._id)} />}
            <button onClick={() => setOpen(lead._id)} className="min-w-0 flex-1 text-left">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">{lead.name}</span>
                <Badge tone={leadTone(lead.status)}>{lead.status}</Badge>
                {lead.phone && <span className="text-xs tabular-nums text-[var(--muted)]">{lead.phone}</span>}
              </div>
              {lead.cart && <CartLine cart={lead.cart} />}
              <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
                {lead.lastContactedAt ? `Last contacted ${formatDate(lead.lastContactedAt)}${lead.contactCount ? ` · ${lead.contactCount}×` : ""}` : "Not contacted yet"}
                {lead.followUpAt ? ` · follow up ${formatDate(lead.followUpAt)}` : ""}
              </p>
            </button>
            <span className="shrink-0 text-right text-xs">
              {lead.assignedTo ? <><span className="font-semibold">{lead.assignedTo.name}</span>{lead.assignedAt && <span className="block text-[var(--muted)]">since {formatDate(lead.assignedAt)}</span>}</> : <span className="text-[var(--muted)]">Unassigned</span>}
            </span>
            {telUrl(lead.phone) && <a href={telUrl(lead.phone)!} aria-label={`Call ${lead.name}`} className="tap grid shrink-0 place-items-center rounded-[10px] text-[var(--brand)] hover:bg-[var(--surface-2)]"><Phone size={17} /></a>}
          </div>
        ))}
      </Card>
    )}

    {data && data.pages > 1 && (
      <div className="flex items-center justify-center gap-3 text-sm">
        <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="tap grid place-items-center rounded-[10px] disabled:opacity-30" aria-label="Previous page"><ChevronLeft size={18} /></button>
        <span>Page {data.page} of {data.pages} · {data.total} carts</span>
        <button disabled={page >= data.pages} onClick={() => setPage(page + 1)} className="tap grid place-items-center rounded-[10px] disabled:opacity-30" aria-label="Next page"><ChevronRight size={18} /></button>
      </div>
    )}

    {open && <LeadDialog id={open} orderPath="/admin/sales/orders" onClose={() => setOpen(null)} onChanged={load} />}
  </div>;
}
