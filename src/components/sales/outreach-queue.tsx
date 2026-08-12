"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft, CheckCircle2, MapPin, MessageSquare, PhoneOff, Send, SkipForward
} from "lucide-react";
import { Badge, Button, Card, EmptyState, Field, Notice, Spinner } from "@/components/ui/kit";
import { MessageTemplates } from "@/components/sales/message-templates";
import { buildQueue, whatsappSendUrl, type QueueEntry, type TemplateRecord } from "@/lib/sales/outreach";
import type { SalesLeadRecord } from "@/lib/sales/types";

/** How many leads one sitting pulls. The API's own ceiling per page. */
const BATCH = 100;

type Entry = QueueEntry & { lead: SalesLeadRecord };

/**
 * Working through a list on WhatsApp, one tap each.
 *
 * Built for a phone held in one hand, because that is where it will be used —
 * the person doing this is not at a desk, and the whole value proposition is
 * that it beats typing the same message two hundred times on the same phone.
 * Hence one lead on screen at a time rather than a table with a column of
 * buttons: a list of forty send links is a list you lose your place in, and
 * losing your place here means messaging a parlour twice.
 *
 * The tap opens WhatsApp with the message already written. What happens next is
 * out of this application's hands and always will be — see the `contacted`
 * route for why the mark is written optimistically, and why Back exists.
 */
export function OutreachQueue({ mayEdit }: { mayEdit: boolean }) {
  const [templates, setTemplates] = useState<TemplateRecord[] | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [filters, setFilters] = useState({ type: "", city: "", freshOnly: true });
  const [types, setTypes] = useState<string[]>([]);
  const [matches, setMatches] = useState<number | null>(null);
  const [counting, setCounting] = useState(true);

  const [queue, setQueue] = useState<Entry[] | null>(null);
  const [index, setIndex] = useState(0);
  const [sent, setSent] = useState<Set<string>>(new Set());
  const [managing, setManaging] = useState(false);
  const [error, setError] = useState("");

  const loadTemplates = useCallback(async () => {
    const response = await fetch("/api/sales/templates");
    const json = await response.json() as { data?: { items: TemplateRecord[] } };
    const items = json.data?.items ?? [];
    setTemplates(items);
    setTemplateId(current => current || items[0]?._id || "");
  }, []);

  /** The search the Start button is about to run, asked for a count only. */
  const search = useCallback((limit: number) => {
    const params = new URLSearchParams({ limit: String(limit), sort: "outreach" });
    if (filters.type) params.set("type", filters.type);
    if (filters.city) params.set("city", filters.city);
    if (filters.freshOnly) params.set("contacted", "never");
    return fetch(`/api/sales/leads?${params}`);
  }, [filters]);

  const count = useCallback(async () => {
    setCounting(true);
    const response = await search(1);
    const json = await response.json() as { data?: { total: number; types: string[] } };
    setMatches(json.data?.total ?? 0);
    setTypes(json.data?.types ?? []);
    setCounting(false);
  }, [search]);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);
  useEffect(() => { count(); }, [count]);

  const template = templates?.find(row => row._id === templateId);

  async function start() {
    if (!template) return;
    setError("");
    const response = await search(BATCH);
    const json = await response.json() as { data?: { items: SalesLeadRecord[] } };
    const leads = json.data?.items ?? [];
    if (!leads.length) { setError("Nothing matches those filters any more."); return; }

    setQueue(buildQueue(leads, template.body) as Entry[]);
    setIndex(0);
    setSent(new Set());
  }

  /**
   * Records the send and moves on.
   *
   * Deliberately not awaited before advancing. The anchor beside this is
   * already handing the browser to WhatsApp, and blocking the next card on a
   * round trip would leave somebody returning from the app to a spinner. A
   * failure surfaces as a notice and the lead stays in tomorrow's queue, which
   * is the harmless direction to be wrong in.
   */
  function markSent(entry: Entry) {
    setSent(current => new Set(current).add(entry.lead._id));
    setIndex(current => current + 1);

    fetch(`/api/sales/leads/${entry.lead._id}/contacted`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: entry.message, templateId })
    }).then(async response => {
      if (!response.ok) {
        const json = await response.json() as { error?: string };
        setError(json.error ?? `${entry.lead.name} could not be marked as messaged.`);
      }
    }).catch(() => setError(`${entry.lead.name} could not be marked as messaged.`));
  }

  /**
   * Editing what this one lead gets, without touching the saved template.
   *
   * The link is rebuilt from the number rather than patched, so a reworded
   * message and the URL that carries it cannot drift apart.
   */
  function reword(text: string) {
    setQueue(current => current && current.map((entry, at) =>
      at === index
        ? { ...entry, message: text, url: whatsappSendUrl(entry.lead.phone, text) }
        : entry
    ));
  }

  if (!templates || counting && matches === null) return <Spinner label="Loading…" />;

  // ------------------------------------------------------------- the queue itself

  if (queue) {
    const entry = queue[index];

    if (!entry) return <div className="space-y-5">
      <Card className="p-8 text-center">
        <CheckCircle2 size={36} className="mx-auto text-[var(--ok-ink)]" />
        <h2 className="mt-3 text-lg font-semibold">Batch done</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {sent.size} of {queue.length} messaged. {queue.length - sent.size > 0
            ? `${queue.length - sent.size} skipped — they stay in the list.`
            : "Every one in this batch was messaged."}
        </p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button onClick={() => { setQueue(null); count(); }}>Back to setup</Button>
          <Button tone="secondary" onClick={() => { start(); count(); }}>Load the next {BATCH}</Button>
        </div>
      </Card>
    </div>;

    const done = index;
    const lead = entry.lead;

    return <div className="space-y-4">
      {error && <Notice tone="error">{error}</Notice>}

      <div>
        <div className="flex items-center justify-between text-sm">
          <button onClick={() => { setQueue(null); count(); }}
            className="tap inline-flex items-center gap-1.5 text-[var(--muted)] hover:text-[var(--ink)]">
            <ArrowLeft size={15} />Setup
          </button>
          <span className="font-semibold text-[var(--muted)]">{done + 1} of {queue.length}</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--brand-soft)]">
          <div className="h-full rounded-full bg-[var(--brand)] transition-all"
            style={{ width: `${(done / queue.length) * 100}%` }} />
        </div>
      </div>

      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="wrap-break-word text-base font-semibold">{lead.name}</p>
          <Badge tone="brand">{lead.type}</Badge>
          {(lead.contactCount ?? 0) > 0 && (
            <Badge tone="warn">Messaged {lead.contactCount}× before</Badge>
          )}
        </div>

        <p className="mt-1.5 flex items-start gap-1.5 text-xs text-[var(--ink-2)]">
          <MapPin size={12} className="mt-0.5 shrink-0 text-[var(--muted)]" />
          <span className="wrap-break-word">{lead.address || lead.city || "Address not published"}</span>
        </p>

        <div className="mt-4">
          <Field label="Message" hint="Change it for this one lead if you want — the saved message stays as it is.">
            <textarea className="textarea" rows={6} value={entry.message}
              onChange={event => reword(event.target.value)} />
          </Field>
        </div>

        {entry.url ? (
          <a href={entry.url} target="_blank" rel="noreferrer" onClick={() => markSent(entry)}
            className="mt-4 inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-[10px] bg-[var(--brand)] px-4 text-sm font-semibold text-[var(--on-brand)] transition-colors hover:bg-[var(--brand-hover)]">
            <Send size={17} />Send on WhatsApp
          </a>
        ) : (
          <Notice tone="warning">
            <span className="flex items-center gap-1.5">
              <PhoneOff size={14} />
              {lead.phone
                ? `“${lead.phone}” is not a number WhatsApp can open. Correct it on the saved list.`
                : "Google published no number for this one."}
            </span>
          </Notice>
        )}

        <div className="mt-3 flex items-center justify-between">
          <button onClick={() => setIndex(current => Math.max(0, current - 1))} disabled={index === 0}
            className="tap inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--ink)] disabled:opacity-40">
            <ArrowLeft size={15} />Back
          </button>
          <button onClick={() => setIndex(current => current + 1)}
            className="tap inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--muted)] hover:text-[var(--ink)]">
            Skip<SkipForward size={15} />
          </button>
        </div>
      </Card>

      <p className="text-center text-xs text-[var(--muted)]">
        WhatsApp opens with the message ready. You press send.
      </p>
    </div>;
  }

  // ------------------------------------------------------------------- setup

  return <div className="space-y-5">
    {error && <Notice tone="error">{error}</Notice>}

    <Card className="space-y-4 p-5">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Field label="Message to send">
            <select className="select" value={templateId} onChange={event => setTemplateId(event.target.value)}>
              {!templates.length && <option value="">No messages written yet</option>}
              {templates.map(row => (
                <option key={row._id} value={row._id}>
                  {row.name}{row.audience ? ` · ${row.audience}` : ""}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Button tone="secondary" className="shrink-0" onClick={() => setManaging(true)}>
          <MessageSquare size={15} />Messages
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type">
          <select className="select" value={filters.type}
            onChange={event => setFilters(current => ({ ...current, type: event.target.value }))}>
            <option value="">Every type</option>
            {types.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </Field>
        <Field label="City" hint="Leave blank for everywhere.">
          <input className="input" value={filters.city} placeholder="Ghaziabad"
            onChange={event => setFilters(current => ({ ...current, city: event.target.value }))} />
        </Field>
      </div>

      <label className="flex items-start gap-2.5 text-sm">
        <input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={filters.freshOnly}
          onChange={event => setFilters(current => ({ ...current, freshOnly: event.target.checked }))} />
        <span>
          Only those never messaged
          <span className="block text-xs text-[var(--muted)]">
            Turn this off to message a list again — the same shop twice in a week is what gets a number blocked.
          </span>
        </span>
      </label>
    </Card>

    {template && (
      <Card className="p-5">
        <p className="text-xs font-semibold text-[var(--muted)]">How it will read</p>
        <div className="mt-2 rounded-[10px] bg-[var(--brand-soft)] px-3.5 py-3 text-sm whitespace-pre-wrap wrap-break-word">
          {buildQueue([{ _id: "sample", name: "Glow Beauty Studio", area: "Indirapuram", city: "Ghaziabad", type: "Beauty parlour" }], template.body)[0].message}
        </div>
      </Card>
    )}

    {!templates.length ? (
      <EmptyState icon={MessageSquare} title="Write a message first"
        description="You need something to send before there is a list to send it to."
        action={mayEdit ? <Button onClick={() => setManaging(true)}>Write one</Button> : undefined} />
    ) : (
      <div className="flex flex-col items-center gap-3">
        <p className="text-sm text-[var(--muted)]">
          {counting ? "Counting…" : <><span className="font-semibold text-[var(--ink)]">{matches}</span> leads match</>}
        </p>
        <Button className="w-full sm:w-auto" disabled={!matches || !template || counting} onClick={start}>
          <Send size={16} />Start sending
        </Button>
        {(matches ?? 0) > BATCH && (
          <p className="text-xs text-[var(--muted)]">{BATCH} at a time — load the next batch when this one is done.</p>
        )}
      </div>
    )}

    {managing && <MessageTemplates templates={templates} mayEdit={mayEdit}
      onChanged={loadTemplates} onClose={() => { setManaging(false); loadTemplates(); }} />}
  </div>;
}
