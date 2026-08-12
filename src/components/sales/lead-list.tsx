"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, MapPin, Phone, Star, Trash2, UsersRound } from "lucide-react";
import { Badge, Button, Card, EmptyState, Field, Notice, Spinner } from "@/components/ui/kit";
import { Modal } from "@/components/ui/modal";
import { formatDate } from "@/lib/time";
import { LEAD_STATUSES, LEAD_TYPE_SUGGESTIONS, leadTone, whatsappUrl, type LeadStatus } from "@/lib/sales/leads";
import type { SalesLeadRecord } from "@/lib/sales/types";

type Response = {
  items: SalesLeadRecord[];
  total: number;
  page: number;
  pages: number;
  counts: Partial<Record<LeadStatus, number>>;
  types: string[];
};

/**
 * The list somebody actually works through.
 *
 * A saved lead's whole life is a phone call and what was said on it, so the
 * status sits on the row as a dropdown that saves as it changes — putting it
 * behind a dialog would mean four clicks to record something that took ten
 * seconds, and a list that nobody keeps up to date is worse than no list.
 * Everything else — a corrected type, a better number, the note about ringing
 * back on Thursday — is the dialog's business.
 */
export function LeadList({ mayEdit, reloadToken }: { mayEdit: boolean; reloadToken: number }) {
  const [filters, setFilters] = useState({ q: "", type: "", status: "" });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<SalesLeadRecord | null>(null);
  const [busyId, setBusyId] = useState<string>();
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const search = new URLSearchParams({ page: String(page), limit: "50" });
    if (filters.q) search.set("q", filters.q);
    if (filters.type) search.set("type", filters.type);
    if (filters.status) search.set("status", filters.status);

    const response = await fetch(`/api/sales/leads?${search}`);
    const json = await response.json() as { data?: Response };
    setData(json.data ?? null);
    setLoading(false);
  }, [filters, page]);

  useEffect(() => { load(); }, [load, reloadToken]);

  const set = (key: keyof typeof filters) => (value: string) => {
    setPage(1);
    setFilters(current => ({ ...current, [key]: value }));
  };

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

  return <div className="space-y-5">
    <Card className="grid gap-4 p-5 sm:grid-cols-3">
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
    </Card>

    {error && <Notice tone="error">{error}</Notice>}

    {empty ? (
      <EmptyState icon={UsersRound} title="No leads saved yet"
        description="Run a search, tick what is worth a call, and it lands here with a status you can work through." />
    ) : !data.items.length ? (
      <EmptyState icon={UsersRound} title="Nothing matches that"
        description="No saved lead matches these filters. Clear them, or search for the trade in a different area." />
    ) : <>
      <Card className="divide-y divide-[var(--line)]">
        {data.items.map(lead => <div key={lead._id} className="flex flex-wrap items-start gap-4 px-5 py-4">
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

            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
              {/*
                * WhatsApp rather than a dial tone.
                *
                * This is how the office actually opens a conversation with a
                * salon: a message they can answer between customers, not a call
                * that interrupts one. `tel:` stays alongside for when somebody
                * does want to ring.
                */}
              <span className="flex items-center gap-1">
                <Phone size={11} />
                {lead.phone ? <>
                  {whatsappUrl(lead.phone)
                    ? <a href={whatsappUrl(lead.phone)!} target="_blank" rel="noreferrer"
                        className="font-semibold text-[var(--brand)] hover:underline">{lead.phone}</a>
                    : <span className="font-semibold">{lead.phone}</span>}
                  <a href={`tel:${lead.phone}`} aria-label={`Call ${lead.name}`}
                    className="text-[var(--muted)] hover:text-[var(--ink)]">· call</a>
                </> : "No number"}
              </span>
              {lead.rating !== undefined && (
                <span className="flex items-center gap-1">
                  <Star size={11} className="fill-amber-400 text-amber-400" />
                  {lead.rating} ({lead.reviewCount ?? 0})
                </span>
              )}
              {lead.googleMapsUrl && (
                <a href={lead.googleMapsUrl} target="_blank" rel="noreferrer"
                  className="flex items-center gap-1 font-semibold text-[var(--brand)]">
                  Maps <ExternalLink size={11} />
                </a>
              )}
              {lead.createdAt && <span>saved {formatDate(lead.createdAt)}</span>}
            </div>

            {lead.notes && <p className="mt-1.5 wrap-break-word text-xs text-[var(--ink-2)]">{lead.notes}</p>}
          </div>

          {mayEdit && <div className="flex shrink-0 items-center gap-2">
            <select className="select w-auto" value={lead.status} disabled={busyId === lead._id}
              aria-label={`Status of ${lead.name}`}
              onChange={event => patch(lead, { status: event.target.value })}>
              {LEAD_STATUSES.map(value => <option key={value} value={value}>{value}</option>)}
            </select>
            <button onClick={() => setEditing(lead)}
              className="text-xs font-semibold text-[var(--brand)] hover:underline">Edit</button>
            <button onClick={() => remove(lead)} disabled={busyId === lead._id}
              aria-label={`Remove ${lead.name}`}
              className="tap inline-flex items-center justify-center text-[var(--muted)] hover:text-[var(--danger-ink)]">
              <Trash2 size={15} />
            </button>
          </div>}
        </div>)}
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

    {editing && <EditLead lead={editing} onClose={() => setEditing(null)}
      onSaved={change => { const lead = editing; setEditing(null); patch(lead, change); }} />}
  </div>;
}

/** Correcting what a search got wrong, and recording what the call turned up. */
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

      <Field label="Notes" hint="What was said, and what happens next.">
        <textarea className="textarea" rows={3} value={notes} onChange={event => setNotes(event.target.value)}
          placeholder="Spoke to the owner — asked to call back after Diwali." />
      </Field>
    </div>
  </Modal>;
}
