"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, MessageSquare, Phone } from "lucide-react";
import { Badge, Card, EmptyState, Field, Notice, Spinner } from "@/components/ui/kit";
import { formatDateTime } from "@/lib/time";
import { LEAD_STATUSES, REMARK_CHANNELS, leadTone, remarkTone } from "@/lib/sales/leads";
import type { LeadRemarkRow } from "@/lib/sales/types";

type Response = {
  items: LeadRemarkRow[];
  total: number;
  page: number;
  pages: number;
  counts: Record<string, number>;
  types: string[];
};

/**
 * Everything said to anybody, newest first.
 *
 * The thread on a row answers "what happened with this parlour". This answers
 * the question a fortnight of calling actually raises — what came of it — and
 * that question is not answerable one row at a time. Filtered by date because
 * the honest version of it is "what did we do last week", and by channel
 * because "rang forty, no answer" and "messaged forty, no reply" are different
 * problems with different answers.
 *
 * Export sits on this screen rather than only on the list for the same reason:
 * the person who wants a spreadsheet of the week's calling is the person who
 * cannot log in to read it.
 */
export function RemarksLog({ mayEdit }: { mayEdit: boolean }) {
  const [filters, setFilters] = useState({ q: "", type: "", status: "", channel: "", from: "", to: "" });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);

  const query = useMemo(() => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value) search.set(key, value);
    return search;
  }, [filters]);

  const load = useCallback(async () => {
    const search = new URLSearchParams(query);
    search.set("page", String(page));
    search.set("limit", "50");

    const response = await fetch(`/api/sales/leads/remarks?${search}`);
    const json = await response.json() as { data?: Response };
    setData(json.data ?? null);
    setLoading(false);
  }, [query, page]);

  useEffect(() => { load(); }, [load]);

  const set = (key: keyof typeof filters) => (value: string) => {
    setPage(1);
    setFilters(current => ({ ...current, [key]: value }));
  };

  if (loading && !data) return <Spinner label="Loading remarks…" />;
  if (!data) return <Notice tone="error">Could not load the remarks.</Notice>;

  const filtered = [...query.keys()].length > 0;

  return <div className="space-y-4">
    <Card className="space-y-4 p-4 sm:p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Search" hint="Matches the wording of a remark as well as the business.">
          <input className="input" value={filters.q} placeholder="Diwali, callback, owner…"
            onChange={event => set("q")(event.target.value)} />
        </Field>
        <Field label="Channel">
          <select className="select" value={filters.channel} onChange={event => set("channel")(event.target.value)}>
            <option value="">Every channel</option>
            {REMARK_CHANNELS.map(value => (
              <option key={value} value={value}>{value} ({data.counts[value] ?? 0})</option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="Type">
          <select className="select" value={filters.type} onChange={event => set("type")(event.target.value)}>
            <option value="">Every type</option>
            {data.types.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </Field>
        <Field label="Lead status">
          <select className="select" value={filters.status} onChange={event => set("status")(event.target.value)}>
            <option value="">Any status</option>
            {LEAD_STATUSES.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </Field>
        <Field label="From">
          <input type="date" className="input" value={filters.from} onChange={event => set("from")(event.target.value)} />
        </Field>
        <Field label="To">
          <input type="date" className="input" value={filters.to} onChange={event => set("to")(event.target.value)} />
        </Field>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-3">
        <p className="text-xs text-[var(--muted)]">
          <span className="font-semibold text-[var(--ink)]">{data.total}</span> remark{data.total === 1 ? "" : "s"}
          {filtered ? " match" : " recorded"}
        </p>
        <a href={`/api/sales/leads/export?scope=remarks&${query}`} download
          className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-[10px] border border-[var(--line-2)] px-3.5 text-xs font-semibold hover:bg-[var(--surface-2)]">
          <Download size={14} />Export to Excel
        </a>
      </div>
    </Card>

    {!data.items.length ? (
      <EmptyState icon={MessageSquare}
        title={filtered ? "Nothing matches that" : "Nothing written down yet"}
        description={filtered
          ? "No remark matches these filters. Widen the dates, or clear the channel."
          : mayEdit
            ? "Tap a number on the saved list, ring it, and write down how it went. It shows up here."
            : "Once calls start being recorded on the saved list, they show up here."} />
    ) : <>
      <Card className="divide-y divide-[var(--line)]">
        {data.items.map(row => (
          <div key={row._id} className="px-4 py-4 sm:px-5">
            <div className="flex flex-wrap items-center gap-2">
              <p className="wrap-break-word text-sm font-semibold">{row.lead.name}</p>
              <Badge tone={remarkTone(row.channel)}>{row.channel}</Badge>
              {row.status && <Badge tone={leadTone(row.status)}>&rarr; {row.status}</Badge>}
            </div>

            {/* Quoted and accented, the way the row and the thread draw one — the
                wording is what this whole screen exists to show, and it was
                reading as ordinary body text between two lines of metadata. */}
            <div className="mt-2 flex gap-2.5 rounded-[10px] border border-[var(--line-2)] bg-[var(--surface-2)] px-3 py-2">
              <span aria-hidden className="w-[3px] shrink-0 self-stretch rounded-full bg-[var(--brand)]" />
              <p className="min-w-0 flex-1 wrap-break-word text-sm whitespace-pre-wrap text-[var(--ink)]">{row.text}</p>
            </div>

            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
              <span>{formatDateTime(row.at)}</span>
              {row.byName && <span>{row.byName}</span>}
              <span>{row.lead.type}</span>
              {(row.lead.area || row.lead.city) && <span>{row.lead.area || row.lead.city}</span>}
              {row.lead.phone && (
                <span className="flex items-center gap-1"><Phone size={11} />{row.lead.phone}</span>
              )}
            </div>
          </div>
        ))}
      </Card>

      {data.pages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <button className="tap px-3 text-[var(--brand)] disabled:text-[var(--muted)]" disabled={page <= 1}
            onClick={() => setPage(current => current - 1)}>Previous</button>
          <span className="text-[var(--muted)]">Page {data.page} of {data.pages} · {data.total} remarks</span>
          <button className="tap px-3 text-[var(--brand)] disabled:text-[var(--muted)]" disabled={page >= data.pages}
            onClick={() => setPage(current => current + 1)}>Next</button>
        </div>
      )}
    </>}
  </div>;
}
