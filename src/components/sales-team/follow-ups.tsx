"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock, Check, MessageCircle, Phone, ShoppingBag, UserPlus } from "lucide-react";
import { Badge, Button, Card, EmptyState, Field, Notice, Spinner } from "@/components/ui/kit";
import { Modal } from "@/components/ui/modal";
import { REMARK_CHANNELS, REMARK_PRESETS, leadTone, telUrl, whatsappUrl, type LeadStatus, type RemarkChannel } from "@/lib/sales/leads";
import { followUpBucket } from "@/lib/sales-team/risk";
import { formatDate, shiftDay, todayIso } from "@/lib/time";
import { call, messageOf } from "./shared";

export type FollowUpLead = {
  _id: string; name: string; phone?: string; city?: string; type?: string; status: LeadStatus;
  followUpAt?: string; followUpNote?: string; lastContactedAt?: string;
};

/** The usual answers to "when shall I ring again?", one tap each. */
const QUICK_DAYS = [{ label: "Tomorrow", days: 1 }, { label: "In 3 days", days: 3 }, { label: "Next week", days: 7 }];

/**
 * One person to ring back: call or WhatsApp in a tap, then say how it went and
 * when to ring next — or that it is done. Used on the dashboard and on the
 * follow-ups list alike.
 */
export function FollowUpRow({ lead, today, onChanged }: { lead: FollowUpLead; today: string; onChanged: () => void }) {
  const [logging, setLogging] = useState(false);
  const bucket = lead.followUpAt ? followUpBucket(lead.followUpAt, today) : null;
  const tel = telUrl(lead.phone);
  const wa = whatsappUrl(lead.phone);

  return <div className="px-4 py-3">
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-semibold">{lead.name}</span>
      <Badge tone={leadTone(lead.status)}>{lead.status}</Badge>
      {bucket && <Badge tone={bucket === "Overdue" ? "danger" : bucket === "Today" ? "warn" : "neutral"}>
        {bucket === "Upcoming" ? formatDate(lead.followUpAt!) : bucket === "Today" ? "Today" : `Overdue · ${formatDate(lead.followUpAt!)}`}
      </Badge>}
    </div>
    <p className="mt-0.5 text-xs text-[var(--muted)]">{[lead.phone, lead.city, lead.type].filter(Boolean).join(" · ")}</p>
    {lead.followUpNote && <p className="mt-1 text-sm text-[var(--ink-2)]">{lead.followUpNote}</p>}
    <div className="mt-2 grid grid-cols-3 gap-2">
      {tel ? <a href={tel} className="tap inline-flex items-center justify-center gap-1.5 rounded-[10px] bg-[var(--brand)] text-xs font-semibold text-[var(--on-brand)]"><Phone size={14} />Call</a> : <span />}
      {wa ? <a href={wa} target="_blank" rel="noreferrer" className="tap inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-[var(--ok-line)] text-xs font-semibold text-[var(--ok-ink)]"><MessageCircle size={14} />WhatsApp</a> : <span />}
      <button onClick={() => setLogging(true)} className="tap inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-[var(--line-2)] text-xs font-semibold"><Check size={14} />Done / next</button>
    </div>
    {logging && <LogCall lead={lead} onClose={() => setLogging(false)} onSaved={() => { setLogging(false); onChanged(); }} />}
  </div>;
}

/**
 * After the call: what was said, where it left them, and when to ring next.
 * "No more follow-up" clears it; an order closes it by itself.
 */
export function LogCall({ lead, onClose, onSaved }: { lead: FollowUpLead; onClose: () => void; onSaved: () => void }) {
  const [text, setText] = useState("");
  const [channel, setChannel] = useState<RemarkChannel>("Call");
  const [status, setStatus] = useState<LeadStatus | "">("");
  const [next, setNext] = useState("");
  const [nextNote, setNextNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setBusy(true); setError("");
    try {
      await call(`/api/sales-team/leads/${lead._id}`, {
        body: { text, channel, status: status || undefined, followUpAt: next || null, followUpNote: nextNote || undefined }
      });
      onSaved();
    } catch (problem) { setError(messageOf(problem)); setBusy(false); }
  }

  return <Modal title={lead.name} description="How did it go?" onClose={onClose}
    footer={<div className="space-y-2">
      <Button className="w-full" busy={busy} disabled={text.trim().length < 2} onClick={save}>Save</Button>
      <Link href={`/executive/orders/new?lead=${lead._id}`} className="tap flex w-full items-center justify-center gap-2 rounded-[10px] border border-[var(--line-2)] text-sm font-semibold"><ShoppingBag size={15} />They said yes — place the order</Link>
    </div>}>
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {REMARK_PRESETS.map(preset => (
          <button key={preset.label} onClick={() => { setText(preset.text); if (preset.status) setStatus(preset.status); }}
            className="rounded-full border border-[var(--line-2)] px-2.5 py-1.5 text-xs hover:bg-[var(--surface-2)]">{preset.label}</button>
        ))}
      </div>
      <textarea className="textarea" rows={3} value={text} onChange={event => setText(event.target.value)} placeholder="What did they say?" />
      <div className="grid grid-cols-2 gap-3">
        <Field label="By">
          <select className="select" value={channel} onChange={event => setChannel(event.target.value as RemarkChannel)}>
            {REMARK_CHANNELS.map(value => <option key={value}>{value}</option>)}
          </select>
        </Field>
        <Field label="They are now">
          <select className="select" value={status} onChange={event => setStatus(event.target.value as LeadStatus | "")}>
            <option value="">Unchanged</option>
            {(["New", "Contacted", "Interested", "Not interested"] as const).map(value => <option key={value}>{value}</option>)}
          </select>
        </Field>
      </div>
      <FollowUpPicker value={next} onChange={setNext} note={nextNote} onNote={setNextNote} />
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  </Modal>;
}

/** When to ring next: quick choices, a date, or none. */
export function FollowUpPicker({ value, onChange, note, onNote }: { value: string; onChange: (day: string) => void; note: string; onNote: (text: string) => void }) {
  const today = todayIso();
  return <div className="space-y-2 rounded-[12px] border border-[var(--line)] p-3">
    <p className="flex items-center gap-1.5 text-sm font-semibold"><CalendarClock size={15} />Next follow-up</p>
    <div className="flex flex-wrap gap-1.5">
      {QUICK_DAYS.map(option => {
        const day = shiftDay(today, option.days);
        return <button key={option.label} type="button" onClick={() => onChange(day)}
          className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${value === day ? "border-[var(--brand)] bg-[var(--brand)] text-[var(--on-brand)]" : "border-[var(--line-2)]"}`}>{option.label}</button>;
      })}
      <button type="button" onClick={() => onChange("")}
        className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${!value ? "border-[var(--brand)] bg-[var(--brand)] text-[var(--on-brand)]" : "border-[var(--line-2)]"}`}>No follow-up</button>
    </div>
    <input type="date" className="input" min={today} value={value} onChange={event => onChange(event.target.value)} aria-label="Follow-up date" />
    {value && <input className="input" value={note} onChange={event => onNote(event.target.value)} placeholder="What to talk about (optional)" />}
  </div>;
}

/** A customer the executive found themselves, with the follow-up they agreed. */
export function AddCustomerModal({ onClose, onSaved }: { onClose: () => void; onSaved: (message: string) => void }) {
  const [form, setForm] = useState({ name: "", phone: "", city: "", address: "", notes: "" });
  const [next, setNext] = useState(shiftDay(todayIso(), 1));
  const [nextNote, setNextNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setBusy(true); setError("");
    try {
      const result = await call<{ message: string }>("/api/sales-team/leads", { body: { ...form, followUpAt: next || undefined, followUpNote: nextNote || undefined } });
      onSaved(result.message);
    } catch (problem) { setError(messageOf(problem)); setBusy(false); }
  }

  return <Modal title="Add a customer" description="Somebody to follow up — a referral, a call, a walk-in." onClose={onClose}
    footer={<Button className="w-full" busy={busy} disabled={form.name.trim().length < 2 || form.phone.replace(/\D/g, "").length < 10} onClick={save}><UserPlus size={16} />Add</Button>}>
    <div className="space-y-4">
      <Field label="Name"><input className="input" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} autoFocus /></Field>
      <Field label="Phone"><input className="input" inputMode="tel" value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} placeholder="10-digit mobile" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="City"><input className="input" value={form.city} onChange={event => setForm({ ...form, city: event.target.value })} /></Field>
        <Field label="Area / address"><input className="input" value={form.address} onChange={event => setForm({ ...form, address: event.target.value })} /></Field>
      </div>
      <Field label="What you talked about"><textarea className="textarea" rows={2} value={form.notes} onChange={event => setForm({ ...form, notes: event.target.value })} placeholder="Wants the pigmentation kit, asked about price…" /></Field>
      <FollowUpPicker value={next} onChange={setNext} note={nextNote} onNote={setNextNote} />
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  </Modal>;
}

/** Every follow-up the executive has set: overdue and today first, then the week ahead. */
export function FollowUpList() {
  const [view, setView] = useState<"due" | "any">("due");
  const [items, setItems] = useState<FollowUpLead[] | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState("");
  const today = todayIso();

  const load = useCallback(async () => {
    try {
      const result = await call<{ items: FollowUpLead[] }>(`/api/sales-team/leads?followUp=${view}&limit=100&open=1`);
      setItems([...result.items].sort((left, right) => String(left.followUpAt).localeCompare(String(right.followUpAt))));
      setError("");
    } catch (problem) { setError(messageOf(problem)); }
  }, [view]);
  useEffect(() => { load(); }, [load]);

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2">
      {([["due", "Due now"], ["any", "All scheduled"]] as const).map(([value, label]) => (
        <button key={value} onClick={() => setView(value)}
          className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${view === value ? "border-[var(--brand)] bg-[var(--brand)] text-[var(--on-brand)]" : "border-[var(--line-2)]"}`}>{label}</button>
      ))}
      <Button className="ml-auto !min-h-[40px]" onClick={() => setAdding(true)}><UserPlus size={16} />Add customer</Button>
    </div>
    {notice && <Notice tone="success">{notice}</Notice>}
    {error && <Notice tone="error">{error}</Notice>}
    {!items && !error && <Spinner label="Loading your follow-ups…" />}
    {items && !items.length && <EmptyState icon={CalendarClock} title={view === "due" ? "Nothing due" : "No follow-ups set"}
      description="Set one when you log a call, or add a customer you have just spoken to." />}
    {items && items.length > 0 && <Card className="divide-y divide-[var(--line)]">
      {items.map(lead => <FollowUpRow key={lead._id} lead={lead} today={today} onChanged={load} />)}
    </Card>}
    {adding && <AddCustomerModal onClose={() => setAdding(false)} onSaved={message => { setAdding(false); setNotice(message); load(); }} />}
  </div>;
}
