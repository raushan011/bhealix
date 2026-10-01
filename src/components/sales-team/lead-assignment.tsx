"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, UserPlus, UserRoundSearch } from "lucide-react";
import { Badge, Button, Card, EmptyState, Notice, Spinner } from "@/components/ui/kit";
import { LEAD_STATUSES, leadTone, type LeadStatus } from "@/lib/sales/leads";
import { formatDate } from "@/lib/time";
import { call, messageOf } from "./shared";

type Lead = {
  _id: string; name: string; type: string; status: LeadStatus; phone?: string; area?: string; city?: string;
  assignedTo?: { _id: string; name: string } | null; assignedAt?: string; lastContactedAt?: string; createdAt?: string;
};
type Page = { items: Lead[]; total: number; page: number; pages: number; counts: Partial<Record<LeadStatus, number>>; types: string[] };

/**
 * Handing leads to the sales team.
 *
 * The leads come from the Leads CRM — found on Google, typed in, or left behind
 * by a past customer. This screen decides who rings them: filter to the ones
 * nobody holds, tick a batch, choose an executive. Taking leads back, or moving
 * them between executives, is the same two clicks, and their remarks go with
 * them.
 */
export function LeadAssignment({ mayAssign }: { mayAssign: boolean }) {
  const initial = useSearchParams().get("assigned");
  const [filters, setFilters] = useState({ assigned: initial ?? "none", status: "", type: "", city: "", q: "" });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page | null>(null);
  const [executives, setExecutives] = useState<Array<{ _id: string; name: string }>>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  useEffect(() => { call<{ items: Array<{ _id: string; name: string }> }>("/api/sales-team/executives").then(result => setExecutives(result.items)).catch(() => undefined); }, []);

  const load = useCallback(async () => {
    const query = new URLSearchParams({ page: String(page), limit: "50" });
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

  return <div className="space-y-4">
    <Card className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
      <select className="select" value={filters.assigned} onChange={event => set("assigned", event.target.value)} aria-label="Held by">
        <option value="none">Nobody holds them</option>
        <option value="any">Held by an executive</option>
        <option value="">Every lead</option>
        {executives.map(person => <option key={person._id} value={person._id}>Held by {person.name}</option>)}
      </select>
      <select className="select" value={filters.status} onChange={event => set("status", event.target.value)} aria-label="Status">
        <option value="">Any status</option>
        {LEAD_STATUSES.map(value => <option key={value} value={value}>{value} ({data?.counts[value] ?? 0})</option>)}
      </select>
      <select className="select" value={filters.type} onChange={event => set("type", event.target.value)} aria-label="Type">
        <option value="">Every type</option>
        {(data?.types ?? []).map(type => <option key={type} value={type}>{type}</option>)}
      </select>
      <input className="input" placeholder="City" value={filters.city} onChange={event => set("city", event.target.value)} />
      <input className="input" placeholder="Name or phone" value={filters.q} onChange={event => set("q", event.target.value)} />
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

    {!data && <Spinner label="Loading leads…" />}
    {data && !data.items.length && <EmptyState icon={UserRoundSearch} title="No leads match" description="Find and save leads in the Leads CRM, then hand them out here." />}
    {data && data.items.length > 0 && (
      <Card className="divide-y divide-[var(--line)]">
        {data.items.map(lead => (
          <label key={lead._id} className="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-[var(--surface-2)] sm:px-5">
            {mayAssign && <input type="checkbox" className="mt-1" disabled={lead.status === "Converted"} checked={selected.has(lead._id)} onChange={() => toggle(lead._id)} />}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">{lead.name}</span>
                <Badge tone={leadTone(lead.status)}>{lead.status}</Badge>
                <span className="text-xs text-[var(--muted)]">{lead.type}</span>
              </div>
              <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
                {[lead.phone, lead.area, lead.city].filter(Boolean).join(" · ")}
                {lead.lastContactedAt ? ` · last contacted ${formatDate(lead.lastContactedAt)}` : ""}
              </p>
            </div>
            <span className="shrink-0 text-right text-xs">
              {lead.assignedTo ? <><span className="font-semibold">{lead.assignedTo.name}</span>{lead.assignedAt && <span className="block text-[var(--muted)]">since {formatDate(lead.assignedAt)}</span>}</> : <span className="text-[var(--muted)]">Unassigned</span>}
            </span>
          </label>
        ))}
      </Card>
    )}

    {data && data.pages > 1 && (
      <div className="flex items-center justify-center gap-3 text-sm">
        <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="tap grid place-items-center rounded-[10px] disabled:opacity-30" aria-label="Previous page"><ChevronLeft size={18} /></button>
        <span>Page {data.page} of {data.pages} · {data.total} leads</span>
        <button disabled={page >= data.pages} onClick={() => setPage(page + 1)} className="tap grid place-items-center rounded-[10px] disabled:opacity-30" aria-label="Next page"><ChevronRight size={18} /></button>
      </div>
    )}
  </div>;
}
