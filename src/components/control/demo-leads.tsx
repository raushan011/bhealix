"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Building2, Inbox, Mail, MessageCircle, Phone, Trash2 } from "lucide-react";
import { Badge, Button, Card, EmptyState, Field, Notice, PageTitle, Spinner, Stat } from "@/components/ui/kit";
import { Modal } from "@/components/ui/modal";
import { formatDateTime } from "@/lib/time";
import { telUrl, whatsappUrl } from "@/lib/sales/leads";
import { DEMO_LEAD_STATUSES, demoLeadTone, type DemoLeadStatus } from "@/lib/demo-leads";

/**
 * The companies that pressed "Book a demo", and what came of each.
 *
 * Worked like the calling desks elsewhere in the app: the status sits on the
 * row and saves as it changes, the number is a button, and the note is where
 * the conversation is kept. New requests are at the top because a request
 * unanswered for a day is a sale somebody else is having.
 */

type DemoLeadRecord = {
  _id: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  role?: string;
  teamSize?: string;
  interests: string[];
  message?: string;
  status: DemoLeadStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

type Payload = { items: DemoLeadRecord[]; total: number; page: number; pages: number; statuses: Record<string, number> };

async function send(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const json = await response.json() as { error?: string; data?: unknown };
  if (!response.ok) throw new Error(json.error ?? "That could not be saved");
  return json.data;
}

export function DemoLeads() {
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string>();
  const [error, setError] = useState("");
  const [noting, setNoting] = useState<DemoLeadRecord | null>(null);

  const requested = useRef(0);
  const load = useCallback(async () => {
    const mine = ++requested.current;
    const search = new URLSearchParams({ page: String(page), limit: "50" });
    if (status) search.set("status", status);
    if (q.trim()) search.set("q", q.trim());
    try {
      const response = await fetch(`/api/control/demo-leads?${search}`);
      const json = await response.json() as { data?: Payload; error?: string };
      if (mine !== requested.current) return;
      if (!response.ok) throw new Error(json.error ?? "Could not read the requests");
      setData(json.data ?? null);
    } catch (problem) {
      if (mine !== requested.current) return;
      setError(problem instanceof Error ? problem.message : "Could not read the requests");
    }
    setLoading(false);
  }, [page, status, q]);

  useEffect(() => { load(); }, [load]);

  async function patch(lead: DemoLeadRecord, change: Record<string, string>) {
    setBusyId(lead._id); setError("");
    try {
      await send(`/api/control/demo-leads/${lead._id}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(change)
      });
      await load();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "That change could not be saved");
    } finally { setBusyId(undefined); }
  }

  async function remove(lead: DemoLeadRecord) {
    if (!window.confirm(`Delete the request from ${lead.company}? Use this for spam and duplicates — a real prospect is marked Lost.`)) return;
    setBusyId(lead._id); setError("");
    try {
      await send(`/api/control/demo-leads/${lead._id}`, { method: "DELETE" });
      await load();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "That request could not be removed");
    } finally { setBusyId(undefined); }
  }

  const statuses = data?.statuses ?? {};
  const open = (statuses["New"] ?? 0) + (statuses["Contacted"] ?? 0) + (statuses["Demo booked"] ?? 0) + (statuses["Proposal sent"] ?? 0);

  return <div className="space-y-5">
    <PageTitle title="Demo leads" subtitle="Every company that asked to see the product — ring them, show them, write down what they said" />

    <div className="flex flex-wrap gap-1.5">
      <Chip active={!status} onClick={() => { setPage(1); setStatus(""); }}>All {data ? `(${Object.values(statuses).reduce((sum, n) => sum + n, 0)})` : ""}</Chip>
      {DEMO_LEAD_STATUSES.map(value => (
        <Chip key={value} active={status === value} onClick={() => { setPage(1); setStatus(status === value ? "" : value); }}>
          {value} {statuses[value] !== undefined ? `(${statuses[value]})` : ""}
        </Chip>
      ))}
    </div>

    <Card className="grid grid-cols-2 gap-5 p-5 sm:grid-cols-4">
      <Stat label="Open requests" value={open} />
      <Stat label="New, not yet called" value={statuses["New"] ?? 0} tone={statuses["New"] ? "text-[var(--warn-ink)]" : undefined} />
      <Stat label="Won" value={statuses["Won"] ?? 0} tone="text-[var(--ok-ink)]" />
      <Stat label="Lost" value={statuses["Lost"] ?? 0} />
    </Card>

    <Card className="p-5">
      <Field label="Search">
        <input className="input" value={q} placeholder="Company, name, email or phone" onChange={event => { setPage(1); setQ(event.target.value); }} />
      </Field>
    </Card>

    {error && <Notice tone="error">{error}</Notice>}

    {loading ? <Spinner label="Loading requests…" /> : !data?.items.length ? (
      <EmptyState icon={Inbox} title="No requests here"
        description={status || q ? "Nothing matches — widen the filter." : "When somebody presses Book a demo on the website, they appear here."} />
    ) : <>
      <Card className="divide-y divide-[var(--line)]">
        {data.items.map(lead => {
          const call = telUrl(lead.phone);
          const chat = whatsappUrl(lead.phone);
          return <div key={lead._id} className="flex flex-wrap items-start gap-4 px-5 py-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold">{lead.company}</p>
                <Badge tone={demoLeadTone(lead.status)}>{lead.status}</Badge>
                {lead.teamSize && <Badge tone="neutral">{lead.teamSize} people</Badge>}
              </div>
              <p className="mt-0.5 text-xs text-[var(--muted)]">
                {lead.name}{lead.role ? ` · ${lead.role}` : ""} · asked {formatDateTime(lead.createdAt)}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {call ? <a href={call} className="inline-flex items-center gap-1 font-medium tabular-nums hover:underline"><Phone size={13} />{lead.phone}</a> : <span className="tabular-nums">{lead.phone}</span>}
                <a href={`mailto:${lead.email}`} className="inline-flex items-center gap-1 text-[var(--ink-2)] hover:underline"><Mail size={13} />{lead.email}</a>
                {chat && <a href={chat} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--ok-ink)] hover:underline"><MessageCircle size={13} />WhatsApp</a>}
              </div>
              {lead.interests.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {lead.interests.map(interest => <span key={interest} className="rounded-full border border-[var(--line-2)] bg-[var(--surface-2)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--ink-2)]">{interest}</span>)}
                </div>
              )}
              {lead.message && <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--ink-2)]">&ldquo;{lead.message}&rdquo;</p>}
              {lead.notes && (
                <div className="mt-2 flex gap-2.5">
                  <span aria-hidden className="w-[3px] shrink-0 self-stretch rounded-full bg-[var(--brand)]" />
                  <p className="whitespace-pre-wrap text-sm text-[var(--ink)]">{lead.notes}</p>
                </div>
              )}
            </div>

            <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:items-end">
              <select className="select w-full text-sm sm:w-auto" value={lead.status} disabled={busyId === lead._id}
                aria-label={`Status of ${lead.company}`} onChange={event => patch(lead, { status: event.target.value })}>
                {DEMO_LEAD_STATUSES.map(value => <option key={value} value={value}>{value}</option>)}
              </select>
              <div className="flex items-center justify-end gap-3">
                <button onClick={() => setNoting(lead)} className="inline-flex items-center gap-1 text-xs font-medium text-[var(--brand)] hover:underline">
                  <Building2 size={12} />{lead.notes ? "Edit note" : "Add note"}
                </button>
                <button onClick={() => remove(lead)} disabled={busyId === lead._id} aria-label={`Delete the request from ${lead.company}`}
                  className="inline-flex items-center text-[var(--muted)] hover:text-[var(--danger-ink)]"><Trash2 size={13} /></button>
              </div>
            </div>
          </div>;
        })}
      </Card>

      {data.pages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <Button tone="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="text-[var(--muted)]">Page {data.page} of {data.pages} · {data.total} requests</span>
          <Button tone="secondary" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </>}

    {noting && <NoteSheet lead={noting} onClose={() => setNoting(null)} onSave={async notes => { await patch(noting, { notes }); setNoting(null); }} />}
  </div>;
}

function NoteSheet({ lead, onClose, onSave }: { lead: DemoLeadRecord; onClose: () => void; onSave: (notes: string) => Promise<void> }) {
  const [notes, setNotes] = useState(lead.notes ?? "");
  const [busy, setBusy] = useState(false);
  return <Modal title={lead.company} description={`${lead.name} · ${lead.email}`} onClose={onClose}
    footer={<div className="flex gap-2">
      <Button tone="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
      <Button className="flex-1" busy={busy} onClick={async () => { setBusy(true); try { await onSave(notes.trim()); } finally { setBusy(false); } }}>Save</Button>
    </div>}>
    <Field label="Note" hint="What was said, what was promised, when to call next.">
      <textarea className="textarea" rows={6} value={notes} onChange={event => setNotes(event.target.value)} autoFocus />
    </Field>
  </Modal>;
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} aria-pressed={active}
    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
      active ? "border-[var(--brand)] bg-[var(--brand)] text-[var(--on-brand)]" : "border-[var(--line-2)] text-[var(--ink-2)] hover:bg-[var(--surface-2)]"}`}>
    {children}
  </button>;
}
