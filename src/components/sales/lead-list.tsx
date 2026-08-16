"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Download, ExternalLink, MapPin, MessageSquare, Phone, PhoneOff, Star, Trash2, UsersRound
} from "lucide-react";
import { Badge, Button, Card, EmptyState, Field, Notice, Spinner } from "@/components/ui/kit";
import { Modal } from "@/components/ui/modal";
import { ContactLead, LeadRemarks } from "@/components/sales/lead-remarks";
import { formatDate, formatDateTime } from "@/lib/time";
import {
  LEAD_STATUSES, LEAD_TYPE_SUGGESTIONS, leadTone, type LeadStatus
} from "@/lib/sales/leads";
import type { SalesLeadRecord } from "@/lib/sales/types";

type Response = {
  items: SalesLeadRecord[];
  total: number;
  page: number;
  pages: number;
  counts: Partial<Record<LeadStatus, number>>;
  types: string[];
};

/** The newest thing said about a lead, which is the one that decides what happens next. */
const latestRemark = (lead: SalesLeadRecord) =>
  [...(lead.remarks ?? [])].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())[0];

/**
 * The list somebody actually works through.
 *
 * A saved lead's whole life is a phone call and what was said on it, so the
 * status sits on the row as a dropdown that saves as it changes — putting it
 * behind a dialog would mean four clicks to record something that took ten
 * seconds, and a list that nobody keeps up to date is worse than no list. What
 * was *said* goes in the thread behind the number, where it is one tap from the
 * call that produced it. Everything else — a corrected type, a better number,
 * the standing note about which day the shop shuts — is the edit dialog's
 * business.
 *
 * The row stacks on a phone rather than sitting the controls beside the details.
 * It used to do the latter, and the details column — being the only one allowed
 * to shrink — collapsed to about a hundred pixels, which turned every address
 * into a column of single words. Below 640px the controls get their own line
 * and the text gets the full width.
 */
export function LeadList({ mayEdit, reloadToken }: { mayEdit: boolean; reloadToken: number }) {
  const [filters, setFilters] = useState({ q: "", type: "", status: "" });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<SalesLeadRecord | null>(null);
  const [contacting, setContacting] = useState<SalesLeadRecord | null>(null);
  const [reading, setReading] = useState<SalesLeadRecord | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string>();
  const [error, setError] = useState("");

  /** The filters as the API reads them — shared with the spreadsheet link, so a
   * download can never carry a different set of rows than the screen. */
  const query = useMemo(() => {
    const search = new URLSearchParams();
    if (filters.q) search.set("q", filters.q);
    if (filters.type) search.set("type", filters.type);
    if (filters.status) search.set("status", filters.status);
    return search;
  }, [filters]);

  const load = useCallback(async () => {
    const search = new URLSearchParams(query);
    search.set("page", String(page));
    search.set("limit", "50");

    const response = await fetch(`/api/sales/leads?${search}`);
    const json = await response.json() as { data?: Response };
    setData(json.data ?? null);
    setLoading(false);
  }, [query, page]);

  useEffect(() => { load(); }, [load, reloadToken]);

  /**
   * A tick is about a row, not about a lead. Changing the filter or turning the
   * page swaps the rows underneath, and acting on a selection made against rows
   * that are no longer on screen is how somebody deletes forty of the wrong ones.
   */
  useEffect(() => { setSelected(new Set()); }, [query, page]);

  const set = (key: keyof typeof filters) => (value: string) => {
    setPage(1);
    setFilters(current => ({ ...current, [key]: value }));
  };

  function toggle(id: string) {
    setSelected(current => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  async function patch(lead: SalesLeadRecord, change: Record<string, string>) {
    setBusyId(lead._id); setError("");
    try {
      const response = await fetch(`/api/sales/leads/${lead._id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(change)
      });
      const json = await response.json() as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "That change could not be saved");
      await load();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "That change could not be saved");
    } finally {
      setBusyId(undefined);
    }
  }

  async function remove(lead: SalesLeadRecord) {
    setBusyId(lead._id); setError("");
    try {
      const response = await fetch(`/api/sales/leads/${lead._id}`, { method: "DELETE" });
      const json = await response.json() as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "That lead could not be removed");
      await load();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "That lead could not be removed");
    } finally {
      setBusyId(undefined);
    }
  }

  if (loading) return <Spinner label="Loading leads…" />;
  if (!data) return <Notice tone="error">Could not load the saved leads.</Notice>;

  const empty = !data.items.length && !filters.q && !filters.type && !filters.status;
  const allTicked = data.items.length > 0 && data.items.every(lead => selected.has(lead._id));

  return <div className="space-y-4">
    <Card className="space-y-4 p-4 sm:p-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Search">
          <input className="input" value={filters.q} placeholder="Name, phone or area"
            onChange={event => set("q")(event.target.value)} />
        </Field>
        <Field label="Type">
          <select className="select" value={filters.type} onChange={event => set("type")(event.target.value)}>
            <option value="">Every type</option>
            {data.types.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select className="select" value={filters.status} onChange={event => set("status")(event.target.value)}>
            <option value="">Any status</option>
            {LEAD_STATUSES.map(value => (
              <option key={value} value={value}>{value} ({data.counts[value] ?? 0})</option>
            ))}
          </select>
        </Field>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-3">
        <p className="text-xs text-[var(--muted)]">
          <span className="font-semibold text-[var(--ink)]">{data.total}</span> lead{data.total === 1 ? "" : "s"} match
        </p>
        {/*
          * A plain anchor with `download`: next/link would client-navigate to the
          * route instead of saving what it returns.
          */}
        <a href={`/api/sales/leads/export?${query}`} download
          className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-[10px] border border-[var(--line-2)] px-3.5 text-xs font-semibold hover:bg-[var(--surface-2)]">
          <Download size={14} />Export to Excel
        </a>
      </div>
    </Card>

    {error && <Notice tone="error">{error}</Notice>}

    {selected.size > 0 && mayEdit && (
      <BulkBar ids={[...selected]} onClear={() => setSelected(new Set())}
        onDone={async () => { setSelected(new Set()); await load(); }} onError={setError} />
    )}

    {empty ? (
      <EmptyState icon={UsersRound} title="No leads saved yet"
        description="Run a search, tick what is worth a call, and it lands here with a status you can work through." />
    ) : !data.items.length ? (
      <EmptyState icon={UsersRound} title="Nothing matches that"
        description="No saved lead matches these filters. Clear them, or search for the trade in a different area." />
    ) : <>
      {mayEdit && (
        <label className="flex items-center gap-2.5 px-1 text-xs font-semibold text-[var(--muted)]">
          <input type="checkbox" className="size-4" checked={allTicked}
            onChange={() => setSelected(allTicked ? new Set() : new Set(data.items.map(lead => lead._id)))} />
          Select all {data.items.length} on this page
        </label>
      )}

      <Card className="divide-y divide-[var(--line)]">
        {data.items.map(lead => {
          const remark = latestRemark(lead);
          const count = lead.remarks?.length ?? 0;
          const ticked = selected.has(lead._id);

          return <div key={lead._id}
            className={`flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:gap-4 sm:px-5 ${
              ticked ? "bg-[var(--brand-soft)]" : ""
            }`}>

            <div className="flex min-w-0 flex-1 items-start gap-2.5">
              {mayEdit && (
                <input type="checkbox" className="mt-1 size-4 shrink-0" checked={ticked}
                  aria-label={`Select ${lead.name}`} onChange={() => toggle(lead._id)} />
              )}

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="wrap-break-word text-sm font-semibold">{lead.name}</p>
                  <Badge tone="brand">{lead.type}</Badge>
                  <Badge tone={leadTone(lead.status)}>{lead.status}</Badge>
                  {lead.source === "Manual" && <Badge tone="info">Added by hand</Badge>}
                </div>

                <p className="mt-1 flex items-start gap-1.5 text-xs text-[var(--ink-2)]">
                  <MapPin size={12} className="mt-0.5 shrink-0 text-[var(--muted)]" />
                  <span className="wrap-break-word">{lead.address || lead.city || "Address not published"}</span>
                </p>

                {/*
                  * The number is a button, not a link.
                  *
                  * Ringing a shopfront and messaging one are different decisions
                  * — a call interrupts a customer being served, a message gets
                  * answered between two of them — and the row used to guess, by
                  * making the number itself a WhatsApp link with a small "call"
                  * beside it. It now asks, and the same sheet is where what was
                  * said gets written down while it is still in somebody's head.
                  */}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {lead.phone ? (
                    <button type="button" onClick={() => setContacting(lead)}
                      className="inline-flex min-h-[38px] items-center gap-1.5 rounded-full border border-[var(--line-2)] bg-[var(--surface)] px-3 text-xs font-semibold text-[var(--brand)] transition-colors hover:bg-[var(--surface-2)]">
                      <Phone size={12} />{lead.phone}
                    </button>
                  ) : (
                    <span className="inline-flex min-h-[38px] items-center gap-1.5 text-xs text-[var(--muted)]">
                      <PhoneOff size={12} />No number
                    </span>
                  )}

                  {/*
                    * A lead that has been spoken to and one that has not are the
                    * two things this list is scanned for, so the chip carries
                    * the difference rather than only saying it: filled and in
                    * the brand when there is a thread behind it, a quiet outline
                    * when it is an invitation to start one.
                    */}
                  <button type="button" onClick={() => setReading(lead)}
                    className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors ${
                      count
                        ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)] hover:bg-[var(--brand-tint)]"
                        : "border-[var(--line-2)] bg-[var(--surface)] text-[var(--muted)] hover:bg-[var(--surface-2)]"
                    }`}>
                    <MessageSquare size={12} />
                    {count ? `${count} remark${count === 1 ? "" : "s"}` : "Add a remark"}
                  </button>
                </div>

                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
                  {lead.rating !== undefined && (
                    <span className="flex items-center gap-1">
                      <Star size={11} className="fill-[var(--star)] text-[var(--star)]" />
                      {lead.rating} ({lead.reviewCount ?? 0})
                    </span>
                  )}
                  {lead.googleMapsUrl && (
                    <a href={lead.googleMapsUrl} target="_blank" rel="noreferrer"
                      className="flex items-center gap-1 font-semibold text-[var(--brand)]">
                      Maps <ExternalLink size={11} />
                    </a>
                  )}
                  {(lead.contactCount ?? 0) > 0 && <span>messaged {lead.contactCount}&times;</span>}
                  {lead.createdAt && <span>saved {formatDate(lead.createdAt)}</span>}
                </div>

                {/*
                  * The last thing said, set off like the quotation it is.
                  *
                  * The accent is a real element rather than a left border,
                  * which matters more than it sounds: `border` and `border-l-*`
                  * are a shorthand and a longhand for the same property, and
                  * which one lands depends on the order the two utilities happen
                  * to be emitted in. A span cannot be overruled.
                  *
                  * It earns the emphasis — this is the sentence that decides
                  * what happens to the lead next, and it used to sit in a 1px
                  * outline that all but vanished on a dark screen.
                  */}
                {remark && (
                  <button type="button" onClick={() => setReading(lead)}
                    className="mt-2 flex w-full gap-2.5 rounded-[10px] border border-[var(--line-2)] bg-[var(--surface-2)] px-3 py-2 text-left transition-colors hover:bg-[var(--brand-soft)]">
                    <span aria-hidden className="w-[3px] shrink-0 self-stretch rounded-full bg-[var(--brand)]" />
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 wrap-break-word text-xs text-[var(--ink)]">
                        &ldquo;{remark.text}&rdquo;
                      </span>
                      <span className="mt-0.5 block text-[11px] text-[var(--muted)]">
                        {remark.channel} · {formatDateTime(remark.at)}{remark.byName ? ` · ${remark.byName}` : ""}
                      </span>
                    </span>
                  </button>
                )}

                {lead.notes && <p className="mt-1.5 wrap-break-word text-xs text-[var(--muted)]">{lead.notes}</p>}
              </div>
            </div>

            {mayEdit && <div className="flex items-center gap-2 sm:shrink-0">
              <select className="select w-auto min-w-0 flex-1 text-sm sm:flex-none" value={lead.status}
                disabled={busyId === lead._id} aria-label={`Status of ${lead.name}`}
                onChange={event => patch(lead, { status: event.target.value })}>
                {LEAD_STATUSES.map(value => <option key={value} value={value}>{value}</option>)}
              </select>
              <button onClick={() => setEditing(lead)}
                className="tap shrink-0 px-2 text-xs font-semibold text-[var(--brand)] hover:underline">Edit</button>
              <button onClick={() => remove(lead)} disabled={busyId === lead._id}
                aria-label={`Remove ${lead.name}`}
                className="tap inline-flex shrink-0 items-center justify-center text-[var(--muted)] hover:text-[var(--danger-ink)]">
                <Trash2 size={15} />
              </button>
            </div>}
          </div>;
        })}
      </Card>

      {data.pages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <button className="tap px-3 text-[var(--brand)] disabled:text-[var(--muted)]" disabled={page <= 1}
            onClick={() => setPage(current => current - 1)}>Previous</button>
          <span className="text-[var(--muted)]">Page {data.page} of {data.pages} · {data.total} leads</span>
          <button className="tap px-3 text-[var(--brand)] disabled:text-[var(--muted)]" disabled={page >= data.pages}
            onClick={() => setPage(current => current + 1)}>Next</button>
        </div>
      )}
    </>}

    {contacting && <ContactLead lead={contacting} mayEdit={mayEdit}
      onClose={() => setContacting(null)} onSaved={load} />}

    {reading && <LeadRemarks lead={reading} mayEdit={mayEdit}
      onClose={() => setReading(null)} onChanged={load} />}

    {editing && <EditLead lead={editing} onClose={() => setEditing(null)}
      onSaved={change => { const lead = editing; setEditing(null); patch(lead, change); }} />}
  </div>;
}

// ------------------------------------------------------------- many at once

/**
 * One change to everything that was ticked.
 *
 * Delete asks first, and the other two do not. The asymmetry is the point: a
 * status set on the wrong forty rows is undone by setting it back, and a
 * confirmation on every batch trains people to dismiss the one that matters.
 */
function BulkBar({ ids, onClear, onDone, onError }: {
  ids: string[];
  onClear: () => void;
  onDone: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [retyping, setRetyping] = useState(false);
  const [type, setType] = useState("");

  async function run(body: Record<string, unknown>) {
    setBusy(true); onError("");
    try {
      const response = await fetch("/api/sales/leads/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids, ...body })
      });
      const json = await response.json() as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "Those leads could not be changed");
      setConfirming(false);
      setRetyping(false);
      setType("");
      await onDone();
    } catch (problem) {
      onError(problem instanceof Error ? problem.message : "Those leads could not be changed");
    } finally {
      setBusy(false);
    }
  }

  return <Card className="flex flex-wrap items-center gap-2 p-3">
    <p className="mr-auto text-sm font-semibold">{ids.length} selected</p>

    <select className="select w-auto text-sm" value="" disabled={busy}
      aria-label="Set the status of every selected lead"
      onChange={event => event.target.value && run({ action: "status", status: event.target.value })}>
      <option value="">Set status…</option>
      {LEAD_STATUSES.map(value => <option key={value} value={value}>{value}</option>)}
    </select>

    <Button tone="secondary" className="min-h-[44px] px-3 text-xs" disabled={busy}
      onClick={() => setRetyping(true)}>Change type</Button>
    <Button tone="danger" className="min-h-[44px] px-3 text-xs" disabled={busy}
      onClick={() => setConfirming(true)}><Trash2 size={14} />Delete</Button>
    <Button tone="ghost" className="min-h-[44px] px-3 text-xs" disabled={busy} onClick={onClear}>Clear</Button>

    {retyping && <Modal title={`File ${ids.length} lead${ids.length === 1 ? "" : "s"} under`}
      description="This is what makes them findable again. It replaces whatever they are filed under now."
      onClose={() => setRetyping(false)}
      footer={<div className="flex gap-2">
        <Button tone="secondary" className="flex-1" onClick={() => setRetyping(false)}>Cancel</Button>
        <Button className="flex-1" busy={busy} disabled={type.trim().length < 2}
          onClick={() => run({ action: "type", type: type.trim() })}>Change type</Button>
      </div>}>
      <Field label="Type">
        <input className="input" list="lead-types-bulk" value={type} autoFocus
          onChange={event => setType(event.target.value)} />
        <datalist id="lead-types-bulk">
          {LEAD_TYPE_SUGGESTIONS.map(suggestion => <option key={suggestion} value={suggestion} />)}
        </datalist>
      </Field>
    </Modal>}

    {confirming && <Modal title={`Delete ${ids.length} lead${ids.length === 1 ? "" : "s"}?`}
      description="The remarks written against them go too. A later sweep of the same area will find the businesses again, but not what was said to them."
      onClose={() => setConfirming(false)}
      footer={<div className="flex gap-2">
        <Button tone="secondary" className="flex-1" onClick={() => setConfirming(false)}>Keep them</Button>
        <Button tone="danger" className="flex-1" busy={busy}
          onClick={() => run({ action: "delete" })}>Delete {ids.length}</Button>
      </div>}>
      <p className="text-sm text-[var(--ink-2)]">This cannot be undone.</p>
    </Modal>}
  </Card>;
}

/** Correcting what a search got wrong, and the standing note about the place. */
function EditLead({ lead, onClose, onSaved }: {
  lead: SalesLeadRecord;
  onClose: () => void;
  onSaved: (change: Record<string, string>) => void;
}) {
  const [type, setType] = useState(lead.type);
  const [phone, setPhone] = useState(lead.phone ?? "");
  const [notes, setNotes] = useState(lead.notes ?? "");

  return <Modal title={lead.name} description={lead.address || lead.city || "No address published"} onClose={onClose}
    footer={<div className="flex gap-2">
      <Button tone="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
      <Button className="flex-1" onClick={() => onSaved({ type: type.trim(), phone: phone.trim(), notes: notes.trim() })}>
        Save
      </Button>
    </div>}>

    <div className="space-y-4">
      <Field label="Type" hint="What this lead is filed under. Correcting it here moves it in the filters too.">
        <input className="input" list="lead-types-edit" value={type} onChange={event => setType(event.target.value)} />
        <datalist id="lead-types-edit">
          {LEAD_TYPE_SUGGESTIONS.map(suggestion => <option key={suggestion} value={suggestion} />)}
        </datalist>
      </Field>

      <Field label="Phone" hint="Google publishes the landline more often than the mobile. The one that was answered belongs here.">
        <input className="input" value={phone} onChange={event => setPhone(event.target.value)} />
      </Field>

      <Field label="Notes" hint="What to know before dialling — which day the shop shuts, who to ask for. What was said on a call goes in the remarks instead.">
        <textarea className="textarea" rows={3} value={notes} onChange={event => setNotes(event.target.value)}
          placeholder="Ask for Meena. Shut on Tuesdays." />
      </Field>
    </div>
  </Modal>;
}
