"use client";

import { useState } from "react";
import { Check, Copy, MessageSquare, Pencil, Phone, Trash2 } from "lucide-react";
import { Badge, Button, Field, Notice } from "@/components/ui/kit";
import { Modal } from "@/components/ui/modal";
import { formatDateTime } from "@/lib/time";
import {
  LEAD_STATUSES, REMARK_CHANNELS, REMARK_PRESETS, leadTone, remarkTone, telUrl, whatsappUrl,
  type RemarkChannel
} from "@/lib/sales/leads";
import type { LeadRemark, SalesLeadRecord } from "@/lib/sales/types";

/**
 * What happened on the call, taken down while it is still in somebody's head.
 *
 * The whole design turns on one observation: the moment a remark will actually
 * be written is the ten seconds after the call ends, on the same phone that made
 * it, and any flow that asks somebody to find the row again afterwards collects
 * nothing. So dialling and writing it down are one screen — the number is the
 * button, and the box for what was said is already open underneath it.
 */

async function send(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const json = await response.json() as { error?: string; data?: SalesLeadRecord };
  if (!response.ok) throw new Error(json.error ?? "That could not be saved");
  return json.data;
}

/** Newest first — a thread is read from what just happened backwards. */
const newestFirst = (remarks: LeadRemark[] = []) =>
  [...remarks].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

// --------------------------------------------------------------- the composer

/**
 * One remark, and where it leaves the lead.
 *
 * The presets are the point. A free textarea on a phone held in one hand
 * collects nothing, and an empty thread is worse than no thread because the list
 * then lies about having been worked. A tap fills in both the sentence and the
 * status, and the box stays editable underneath for the calls that were not one
 * of the five.
 */
function Composer({ channel, onChannel, busy, onSave }: {
  channel: RemarkChannel;
  onChannel: (channel: RemarkChannel) => void;
  busy: boolean;
  onSave: (remark: { text: string; channel: RemarkChannel; status?: string }) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState("");

  async function save() {
    if (await onSave({ text: text.trim(), channel, status: status || undefined })) {
      setText("");
      setStatus("");
    }
  }

  return <div className="space-y-3">
    <div className="flex flex-wrap gap-1.5">
      {REMARK_PRESETS.map(preset => (
        <button key={preset.label} type="button"
          onClick={() => { setText(preset.text); if (preset.status) setStatus(preset.status); }}
          className="rounded-full border border-[var(--line-2)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-2)] transition-colors hover:bg-[var(--surface-2)]">
          {preset.label}
        </button>
      ))}
    </div>

    <Field label="What was said">
      <textarea className="textarea" rows={3} value={text} onChange={event => setText(event.target.value)}
        placeholder="Spoke to the owner — asked to call back after Diwali." />
    </Field>

    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Filed under">
        <select className="select" value={channel}
          onChange={event => onChannel(event.target.value as RemarkChannel)}>
          {REMARK_CHANNELS.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </Field>
      <Field label="Move the lead to">
        <select className="select" value={status} onChange={event => setStatus(event.target.value)}>
          <option value="">Leave as it is</option>
          {LEAD_STATUSES.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </Field>
    </div>

    <Button className="w-full" busy={busy} disabled={text.trim().length < 2} onClick={save}>
      Save remark
    </Button>
  </div>;
}

// ------------------------------------------------------------ the contact sheet

/**
 * Tapping the number.
 *
 * Two ways to reach a shopfront and they are not interchangeable — a call
 * interrupts a customer being served, a message gets answered between two of
 * them — so the choice is put to whoever is doing the work rather than guessed
 * at by the row. Choosing one also files the remark under it, which is what
 * makes the log afterwards worth reading: "rang four times, no answer" and "sent
 * four messages, no reply" are different problems.
 */
export function ContactLead({ lead, mayEdit, onClose, onSaved }: {
  lead: SalesLeadRecord;
  mayEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [channel, setChannel] = useState<RemarkChannel>("Call");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const call = telUrl(lead.phone);
  const chat = whatsappUrl(lead.phone);
  const latest = newestFirst(lead.remarks)[0];

  async function copy() {
    try {
      await navigator.clipboard.writeText(lead.phone ?? "");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access is refused outright on an insecure origin and in some
      // embedded browsers. The number is on screen and can be read off it.
      setError("Could not copy — the number is above.");
    }
  }

  async function save(remark: { text: string; channel: RemarkChannel; status?: string }) {
    setBusy(true); setError("");
    try {
      await send(`/api/sales/leads/${lead._id}/remarks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(remark)
      });
      onSaved();
      onClose();
      return true;
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "That remark could not be saved");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return <Modal title={lead.name} description={lead.address || lead.city || "No address published"} onClose={onClose}>
    <div className="space-y-4">
      {error && <Notice tone="error">{error}</Notice>}

      {lead.phone ? <>
        <div className="rounded-[10px] bg-[var(--brand-soft)] px-4 py-3 text-center">
          <p className="text-lg font-semibold tracking-wide tabular-nums">{lead.phone}</p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {/*
            * Plain anchors, not buttons with an onClick. `tel:` and `wa.me` are
            * handed to the operating system, and a browser will open a link the
            * person tapped where it will block one a script navigated to.
            */}
          <a href={call ?? undefined} aria-disabled={!call}
            className={`inline-flex min-h-[52px] items-center justify-center gap-2 rounded-[10px] text-sm font-semibold transition-colors ${
              call ? "bg-[var(--brand)] text-[var(--on-brand)] hover:bg-[var(--brand-hover)]"
                : "cursor-not-allowed bg-[var(--surface-2)] text-[var(--muted)]"
            }`}
            onClick={() => call && setChannel("Call")}>
            <Phone size={17} />Call
          </a>
          <a href={chat ?? undefined} target="_blank" rel="noreferrer" aria-disabled={!chat}
            className={`inline-flex min-h-[52px] items-center justify-center gap-2 rounded-[10px] border text-sm font-semibold transition-colors ${
              chat ? "border-[var(--ok-line)] bg-[var(--ok-bg)] text-[var(--ok-ink)] hover:opacity-90"
                : "cursor-not-allowed border-[var(--line)] bg-[var(--surface-2)] text-[var(--muted)]"
            }`}
            onClick={() => chat && setChannel("WhatsApp")}>
            <MessageSquare size={17} />WhatsApp
          </a>
        </div>

        <button type="button" onClick={copy}
          className="tap inline-flex w-full items-center justify-center gap-1.5 text-xs font-semibold text-[var(--muted)] hover:text-[var(--ink)]">
          {copied ? <><Check size={13} />Copied</> : <><Copy size={13} />Copy the number</>}
        </button>

        {!chat && (
          <Notice tone="warning">
            WhatsApp cannot open &ldquo;{lead.phone}&rdquo; — it is most likely a landline. Correct it on the row if
            there is a mobile.
          </Notice>
        )}
      </> : (
        <Notice tone="warning">Google published no number for this one. Add it with Edit on the row.</Notice>
      )}

      {/* The same quoted-and-accented signature the row and the log use, so a
          remark is recognisable as one wherever it turns up. */}
      {latest && (
        <div className="flex gap-2.5 rounded-[10px] border border-[var(--line-2)] bg-[var(--surface-2)] px-3.5 py-3">
          <span aria-hidden className="w-[3px] shrink-0 self-stretch rounded-full bg-[var(--brand)]" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-[var(--muted)]">Last time</p>
            <p className="mt-1 wrap-break-word text-sm text-[var(--ink)]">{latest.text}</p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {latest.channel} · {formatDateTime(latest.at)}{latest.byName ? ` · ${latest.byName}` : ""}
            </p>
          </div>
        </div>
      )}

      {mayEdit ? <>
        <div className="border-t border-[var(--line)] pt-4">
          <p className="mb-3 text-sm font-semibold">How did it go?</p>
          <Composer channel={channel} onChannel={setChannel} busy={busy} onSave={save} />
        </div>
      </> : (
        <p className="text-xs text-[var(--muted)]">Recording what was said is the administrator&rsquo;s to do.</p>
      )}
    </div>
  </Modal>;
}

// ---------------------------------------------------------------- the thread

/** Everything ever said about one lead, in order, with each line correctable. */
export function LeadRemarks({ lead, mayEdit, onClose, onChanged }: {
  lead: SalesLeadRecord;
  mayEdit: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [remarks, setRemarks] = useState<LeadRemark[]>(newestFirst(lead.remarks));
  const [channel, setChannel] = useState<RemarkChannel>("Note");
  const [editing, setEditing] = useState<string>();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** Whether the list behind this needs re-reading when it closes. */
  const [touched, setTouched] = useState(false);

  async function run(work: () => Promise<SalesLeadRecord | undefined>, whenWrong: string) {
    setBusy(true); setError("");
    try {
      const updated = await work();
      setRemarks(newestFirst(updated?.remarks));
      setTouched(true);
      return true;
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : whenWrong);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const add = (remark: { text: string; channel: RemarkChannel; status?: string }) =>
    run(() => send(`/api/sales/leads/${lead._id}/remarks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(remark)
    }), "That remark could not be saved");

  const saveEdit = (remarkId: string) =>
    run(() => send(`/api/sales/leads/${lead._id}/remarks/${remarkId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: draft.trim() })
    }), "That change could not be saved").then(worked => { if (worked) setEditing(undefined); });

  const remove = (remarkId: string) =>
    run(() => send(`/api/sales/leads/${lead._id}/remarks/${remarkId}`, { method: "DELETE" }),
      "That remark could not be removed");

  function close() {
    if (touched) onChanged();
    onClose();
  }

  return <Modal title={`${lead.name} — remarks`} description={`${remarks.length} recorded`} onClose={close}>
    <div className="space-y-5">
      {error && <Notice tone="error">{error}</Notice>}

      {mayEdit && <Composer channel={channel} onChannel={setChannel} busy={busy} onSave={add} />}

      <div className="space-y-3 border-t border-[var(--line)] pt-4">
        {!remarks.length ? (
          <p className="py-4 text-center text-sm text-[var(--muted)]">
            Nothing written down yet. The first call is the one worth recording.
          </p>
        ) : remarks.map(remark => (
          <div key={remark._id}
            className="flex gap-2.5 rounded-[10px] border border-[var(--line-2)] bg-[var(--surface-2)] px-3.5 py-3">
            <span aria-hidden className="w-[3px] shrink-0 self-stretch rounded-full bg-[var(--brand)]" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={remarkTone(remark.channel)}>{remark.channel}</Badge>
                {remark.status && <Badge tone={leadTone(remark.status)}>&rarr; {remark.status}</Badge>}
                <span className="text-xs text-[var(--muted)]">{formatDateTime(remark.at)}</span>
              </div>

              {editing === remark._id ? (
                <div className="mt-2 space-y-2">
                  <textarea className="textarea" rows={3} value={draft}
                    onChange={event => setDraft(event.target.value)} />
                  <div className="flex gap-2">
                    <Button tone="secondary" className="flex-1" onClick={() => setEditing(undefined)}>Cancel</Button>
                    <Button className="flex-1" busy={busy} disabled={draft.trim().length < 2}
                      onClick={() => saveEdit(remark._id)}>Save</Button>
                  </div>
                </div>
              ) : <>
                <p className="mt-1.5 wrap-break-word text-sm whitespace-pre-wrap text-[var(--ink)]">{remark.text}</p>
                <div className="mt-1.5 flex items-center justify-between gap-3">
                  <span className="truncate text-xs text-[var(--muted)]">{remark.byName ?? "—"}</span>
                  {mayEdit && (
                    <span className="flex shrink-0 items-center gap-3">
                      <button onClick={() => { setEditing(remark._id); setDraft(remark.text); }}
                        aria-label="Edit this remark"
                        className="tap inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand)]">
                        <Pencil size={12} />Edit
                      </button>
                      <button onClick={() => remove(remark._id)} disabled={busy}
                        aria-label="Delete this remark"
                        className="tap inline-flex items-center text-[var(--muted)] hover:text-[var(--danger-ink)]">
                        <Trash2 size={13} />
                      </button>
                    </span>
                  )}
                </div>
              </>}
            </div>
          </div>
        ))}
      </div>
    </div>
  </Modal>;
}
