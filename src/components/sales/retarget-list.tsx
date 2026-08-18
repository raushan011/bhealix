"use client";

import { useState } from "react";
import { Check, Copy, MessageSquare, MessagesSquare, Pencil, Phone, Trash2 } from "lucide-react";
import { Badge, Button, Card, EmptyState, Field, Notice } from "@/components/ui/kit";
import { Modal } from "@/components/ui/modal";
import { formatDate, formatDateTime, toDateInput } from "@/lib/time";
import { deliveryTone } from "@/lib/sales/delivery";
import { REMARK_CHANNELS, remarkTone, telUrl, whatsappUrl, type RemarkChannel } from "@/lib/sales/leads";
import { RETARGET_PRESETS, RETARGET_STATUSES, retargetTone, type RetargetStatus } from "@/lib/sales/retarget";
import { formatRupees, type RetargetRemark, type ShopOrderRecord } from "@/lib/sales/types";

/**
 * Every Shopify order as a person to ring, and the ten seconds after the call.
 *
 * The same shape as the lead list next door, and for the same reason: the
 * remark is written on the phone that made the call, in the moment after it
 * ends, or it is not written at all. So the number is the button and the box
 * for what was said is already open under it.
 */

async function send(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const json = await response.json() as { error?: string; data?: ShopOrderRecord };
  if (!response.ok) throw new Error(json.error ?? "That could not be saved");
  return json.data;
}

const newestFirst = (remarks: RetargetRemark[] = []) =>
  [...remarks].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

/** The number to dial: the desk's correction first, then whatever the shop had. */
export const phoneOf = (order: ShopOrderRecord) => order.retarget?.phone || order.customer?.phone || "";

const itemsOf = (order: ShopOrderRecord) =>
  (order.items ?? []).map(item => `${item.title}${item.quantity > 1 ? ` ×${item.quantity}` : ""}`).join(", ");

// ------------------------------------------------------------------ the list

export function RetargetList({ orders, mayEdit, onChanged }: {
  orders: ShopOrderRecord[];
  mayEdit: boolean;
  onChanged: () => void;
}) {
  const [contacting, setContacting] = useState<ShopOrderRecord | null>(null);
  const [thread, setThread] = useState<ShopOrderRecord | null>(null);
  const [editing, setEditing] = useState<ShopOrderRecord | null>(null);

  if (!orders.length) {
    return <EmptyState icon={Phone} title="No orders match"
      description="Every Shopify order appears here after a sync — widen the filters, or run a sync to pull the shop's orders in." />;
  }

  return <>
    <Card className="divide-y divide-[var(--line)]">
      {orders.map(order => {
        const rep = typeof order.rep === "object" && order.rep ? order.rep : null;
        const phone = phoneOf(order);
        const due = order.retarget?.nextFollowUpAt && new Date(order.retarget.nextFollowUpAt).getTime() <= Date.now();
        return <div key={order._id} className="flex flex-wrap items-start gap-4 px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold">{order.customer?.name || "Unnamed customer"}</p>
              <span className="text-xs text-[var(--muted)]">{order.name}</span>
              <Badge tone={retargetTone(order.retarget?.status ?? "Not called")}>{order.retarget?.status ?? "Not called"}</Badge>
              {order.delivery?.state
                ? <Badge tone={deliveryTone(order.delivery.state)}>{order.delivery.state}</Badge>
                : <Badge tone={order.fulfilment === "Fulfilled" ? "info" : "neutral"}>{order.fulfilment === "Fulfilled" ? "Shipped" : order.fulfilment === "Partial" ? "Partly shipped" : "Not shipped"}</Badge>}
              {order.cancelledAt && <Badge tone="danger">Cancelled</Badge>}
              {order.customerOrders > 1 && <Badge tone="brand">{order.customerOrders} orders</Badge>}
              {due && <Badge tone="warn">Follow-up due</Badge>}
            </div>

            <p className="mt-0.5 text-xs text-[var(--muted)]">
              {formatDate(order.placedAt)} · {formatRupees(order.total)}
              {order.paymentMethod ? ` · ${order.paymentMethod}` : ""}
              {order.customer?.city ? ` · ${order.customer.city}` : ""}
              {rep ? ` · via ${rep.name} (${order.couponCode ?? rep.code})` : order.discountCodes?.length ? ` · ${order.discountCodes.join(", ")}` : ""}
            </p>
            <p className="mt-0.5 text-xs text-[var(--muted)]">{itemsOf(order)}</p>

            {phone
              ? <p className="mt-1 text-sm font-medium tabular-nums">{phone}{order.retarget?.phone && order.customer?.phone && order.retarget.phone !== order.customer.phone ? <span className="ml-1 text-xs font-normal text-[var(--muted)]">(corrected)</span> : null}</p>
              : <p className="mt-1 text-xs text-[var(--warn-ink)]">No phone number on the order{order.customer?.email ? ` · ${order.customer.email}` : ""}</p>}

            {order.retarget?.lastRemark && (
              <div className="mt-2 flex gap-2.5">
                <span aria-hidden className="w-[3px] shrink-0 self-stretch rounded-full bg-[var(--brand)]" />
                <div className="min-w-0">
                  <p className="wrap-break-word text-sm text-[var(--ink)]">{order.retarget.lastRemark}</p>
                  <p className="text-xs text-[var(--muted)]">
                    {order.retarget.lastChannel ?? "Note"} · {order.retarget.lastRemarkAt ? formatDateTime(order.retarget.lastRemarkAt) : ""}
                    {order.retarget.remarkCount > 1 ? ` · ${order.retarget.remarkCount} remarks` : ""}
                  </p>
                </div>
              </div>
            )}
            {order.retarget?.notes && <p className="mt-1.5 text-xs text-[var(--ink-2)]">Note: {order.retarget.notes}</p>}
            {order.retarget?.nextFollowUpAt && (
              <p className={`mt-1 text-xs ${due ? "text-[var(--warn-ink)]" : "text-[var(--muted)]"}`}>
                Follow up {formatDate(order.retarget.nextFollowUpAt)}
              </p>
            )}
          </div>

          <div className="flex shrink-0 flex-col items-end gap-2">
            <Button className="min-h-[36px] px-3" onClick={() => setContacting(order)} disabled={!phone && !mayEdit}>
              <Phone size={14} />{mayEdit ? "Call" : "Number"}
            </Button>
            <div className="flex items-center gap-3">
              <button onClick={() => setThread(order)}
                className="inline-flex items-center gap-1 text-xs font-medium text-[var(--brand)] hover:underline">
                <MessagesSquare size={12} />Remarks{order.retarget?.remarkCount ? ` (${order.retarget.remarkCount})` : ""}
              </button>
              {mayEdit && (
                <button onClick={() => setEditing(order)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-[var(--brand)] hover:underline">
                  <Pencil size={12} />Edit
                </button>
              )}
            </div>
          </div>
        </div>;
      })}
    </Card>

    {contacting && <ContactCustomer order={contacting} mayEdit={mayEdit} onClose={() => setContacting(null)} onSaved={onChanged} />}
    {thread && <RetargetRemarks order={thread} mayEdit={mayEdit} onClose={() => setThread(null)} onChanged={onChanged} />}
    {editing && <EditRetarget order={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} />}
  </>;
}

// -------------------------------------------------------------- the composer

type Draft = { text: string; channel: RemarkChannel; status?: RetargetStatus; nextFollowUp?: string | null };

function Composer({ channel, onChannel, busy, onSave }: {
  channel: RemarkChannel;
  onChannel: (channel: RemarkChannel) => void;
  busy: boolean;
  onSave: (remark: Draft) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<RetargetStatus | "">("");
  const [followUp, setFollowUp] = useState("");

  async function save() {
    if (await onSave({ text: text.trim(), channel, status: status || undefined, nextFollowUp: followUp || undefined })) {
      setText(""); setStatus(""); setFollowUp("");
    }
  }

  return <div className="space-y-3">
    <div className="flex flex-wrap gap-1.5">
      {RETARGET_PRESETS.map(preset => (
        <button key={preset.label} type="button"
          onClick={() => { setText(preset.text); if (preset.status) setStatus(preset.status); }}
          className="rounded-full border border-[var(--line-2)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-2)] transition-colors hover:bg-[var(--surface-2)]">
          {preset.label}
        </button>
      ))}
    </div>

    <Field label="What was said">
      <textarea className="textarea" rows={3} value={text} onChange={event => setText(event.target.value)}
        placeholder="Spoke to her — happy with the kit, will reorder next month." />
    </Field>

    <div className="grid gap-3 sm:grid-cols-3">
      <Field label="Filed under">
        <select className="select" value={channel} onChange={event => onChannel(event.target.value as RemarkChannel)}>
          {REMARK_CHANNELS.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </Field>
      <Field label="Status">
        <select className="select" value={status} onChange={event => setStatus(event.target.value as RetargetStatus | "")}>
          <option value="">Leave as it is</option>
          {RETARGET_STATUSES.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </Field>
      <Field label="Follow up on">
        <input className="input" type="date" value={followUp} min={toDateInput(new Date())} onChange={event => setFollowUp(event.target.value)} />
      </Field>
    </div>

    <Button className="w-full" busy={busy} disabled={text.trim().length < 2} onClick={save}>Save remark</Button>
  </div>;
}

// -------------------------------------------------------- the contact sheet

function ContactCustomer({ order, mayEdit, onClose, onSaved }: {
  order: ShopOrderRecord;
  mayEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [channel, setChannel] = useState<RemarkChannel>("Call");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const phone = phoneOf(order);
  const call = telUrl(phone);
  const chat = whatsappUrl(phone);
  const latest = newestFirst(order.retarget?.remarks)[0];

  async function copy() {
    try {
      await navigator.clipboard.writeText(phone);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { setError("Could not copy — the number is above."); }
  }

  async function save(remark: Draft) {
    setBusy(true); setError("");
    try {
      await send(`/api/sales/retarget/${order._id}/remarks`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(remark)
      });
      onSaved(); onClose();
      return true;
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "That remark could not be saved");
      return false;
    } finally { setBusy(false); }
  }

  return <Modal title={order.customer?.name || "Customer"}
    description={`${order.name} · ${formatDate(order.placedAt)} · ${itemsOf(order)} · ${formatRupees(order.total)}`} onClose={onClose}>
    <div className="space-y-4">
      {error && <Notice tone="error">{error}</Notice>}

      {phone ? <>
        <div className="rounded-[10px] bg-[var(--brand-soft)] px-4 py-3 text-center">
          <p className="text-lg font-semibold tracking-wide tabular-nums">{phone}</p>
          {order.customer?.city && <p className="text-xs text-[var(--muted)]">{[order.customer.city, order.customer.state].filter(Boolean).join(", ")}</p>}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <a href={call ?? undefined} aria-disabled={!call}
            className={`inline-flex min-h-[52px] items-center justify-center gap-2 rounded-[10px] text-sm font-semibold transition-colors ${
              call ? "bg-[var(--brand)] text-[var(--on-brand)] hover:bg-[var(--brand-hover)]" : "cursor-not-allowed bg-[var(--surface-2)] text-[var(--muted)]"}`}
            onClick={() => call && setChannel("Call")}>
            <Phone size={17} />Call
          </a>
          <a href={chat ?? undefined} target="_blank" rel="noreferrer" aria-disabled={!chat}
            className={`inline-flex min-h-[52px] items-center justify-center gap-2 rounded-[10px] border text-sm font-semibold transition-colors ${
              chat ? "border-[var(--ok-line)] bg-[var(--ok-bg)] text-[var(--ok-ink)] hover:opacity-90" : "cursor-not-allowed border-[var(--line)] bg-[var(--surface-2)] text-[var(--muted)]"}`}
            onClick={() => chat && setChannel("WhatsApp")}>
            <MessageSquare size={17} />WhatsApp
          </a>
        </div>
        <button type="button" onClick={copy}
          className="tap inline-flex w-full items-center justify-center gap-1.5 text-xs font-semibold text-[var(--muted)] hover:text-[var(--ink)]">
          {copied ? <><Check size={13} />Copied</> : <><Copy size={13} />Copy the number</>}
        </button>
      </> : (
        <Notice tone="warning">The order carries no phone number{order.customer?.email ? ` — only ${order.customer.email}` : ""}. Add one with Edit on the row.</Notice>
      )}

      {order.retarget?.notes && <p className="text-sm text-[var(--ink-2)]"><span className="font-semibold">Note:</span> {order.retarget.notes}</p>}

      {latest && (
        <div className="flex gap-2.5 rounded-[10px] border border-[var(--line-2)] bg-[var(--surface-2)] px-3.5 py-3">
          <span aria-hidden className="w-[3px] shrink-0 self-stretch rounded-full bg-[var(--brand)]" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-[var(--muted)]">Last time</p>
            <p className="mt-1 wrap-break-word text-sm text-[var(--ink)]">{latest.text}</p>
            <p className="mt-1 text-xs text-[var(--muted)]">{latest.channel} · {formatDateTime(latest.at)}{latest.byName ? ` · ${latest.byName}` : ""}</p>
          </div>
        </div>
      )}

      {mayEdit ? (
        <div className="border-t border-[var(--line)] pt-4">
          <p className="mb-3 text-sm font-semibold">How did it go?</p>
          <Composer channel={channel} onChannel={setChannel} busy={busy} onSave={save} />
        </div>
      ) : <p className="text-xs text-[var(--muted)]">Recording what was said needs the calling desk&rsquo;s access.</p>}
    </div>
  </Modal>;
}

// ---------------------------------------------------------------- the thread

function RetargetRemarks({ order, mayEdit, onClose, onChanged }: {
  order: ShopOrderRecord;
  mayEdit: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [remarks, setRemarks] = useState<RetargetRemark[]>(newestFirst(order.retarget?.remarks));
  const [channel, setChannel] = useState<RemarkChannel>("Note");
  const [editing, setEditing] = useState<string>();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [touched, setTouched] = useState(false);

  async function run(work: () => Promise<ShopOrderRecord | undefined>, whenWrong: string) {
    setBusy(true); setError("");
    try {
      const updated = await work();
      setRemarks(newestFirst(updated?.retarget?.remarks));
      setTouched(true);
      return true;
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : whenWrong);
      return false;
    } finally { setBusy(false); }
  }

  const add = (remark: Draft) => run(() => send(`/api/sales/retarget/${order._id}/remarks`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(remark)
  }), "That remark could not be saved");

  const saveEdit = (remarkId: string) => run(() => send(`/api/sales/retarget/${order._id}/remarks/${remarkId}`, {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: draft.trim() })
  }), "That change could not be saved").then(worked => { if (worked) setEditing(undefined); });

  const remove = (remarkId: string) => run(() => send(`/api/sales/retarget/${order._id}/remarks/${remarkId}`, { method: "DELETE" }),
    "That remark could not be removed");

  function close() { if (touched) onChanged(); onClose(); }

  return <Modal title={`${order.customer?.name || "Customer"} — ${order.name}`} description={`${remarks.length} remark${remarks.length === 1 ? "" : "s"} · ${itemsOf(order)}`} onClose={close}>
    <div className="space-y-5">
      {error && <Notice tone="error">{error}</Notice>}
      {mayEdit && <Composer channel={channel} onChannel={setChannel} busy={busy} onSave={add} />}

      <div className="space-y-3 border-t border-[var(--line)] pt-4">
        {!remarks.length ? (
          <p className="py-4 text-center text-sm text-[var(--muted)]">Nothing written down yet. The first call is the one worth recording.</p>
        ) : remarks.map(remark => (
          <div key={remark._id} className="flex gap-2.5 rounded-[10px] border border-[var(--line-2)] bg-[var(--surface-2)] px-3.5 py-3">
            <span aria-hidden className="w-[3px] shrink-0 self-stretch rounded-full bg-[var(--brand)]" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={remarkTone(remark.channel)}>{remark.channel}</Badge>
                {remark.status && <Badge tone={retargetTone(remark.status)}>&rarr; {remark.status}</Badge>}
                <span className="text-xs text-[var(--muted)]">{formatDateTime(remark.at)}</span>
              </div>
              {editing === remark._id ? (
                <div className="mt-2 space-y-2">
                  <textarea className="textarea" rows={3} value={draft} onChange={event => setDraft(event.target.value)} />
                  <div className="flex gap-2">
                    <Button tone="secondary" className="flex-1" onClick={() => setEditing(undefined)}>Cancel</Button>
                    <Button className="flex-1" busy={busy} disabled={draft.trim().length < 2} onClick={() => saveEdit(remark._id)}>Save</Button>
                  </div>
                </div>
              ) : <>
                <p className="mt-1.5 wrap-break-word text-sm whitespace-pre-wrap text-[var(--ink)]">{remark.text}</p>
                <div className="mt-1.5 flex items-center justify-between gap-3">
                  <span className="truncate text-xs text-[var(--muted)]">{remark.byName ?? "—"}</span>
                  {mayEdit && (
                    <span className="flex shrink-0 items-center gap-3">
                      <button onClick={() => { setEditing(remark._id); setDraft(remark.text); }} aria-label="Edit this remark"
                        className="tap inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand)]"><Pencil size={12} />Edit</button>
                      <button onClick={() => remove(remark._id)} disabled={busy} aria-label="Delete this remark"
                        className="tap inline-flex items-center text-[var(--muted)] hover:text-[var(--danger-ink)]"><Trash2 size={13} /></button>
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

// ------------------------------------------------------------- the edit sheet

/** Status, standing note, follow-up and a corrected number — without a remark. */
function EditRetarget({ order, onClose, onSaved }: { order: ShopOrderRecord; onClose: () => void; onSaved: () => void }) {
  const [status, setStatus] = useState<RetargetStatus>(order.retarget?.status ?? "Not called");
  const [notes, setNotes] = useState(order.retarget?.notes ?? "");
  const [followUp, setFollowUp] = useState(order.retarget?.nextFollowUpAt ? toDateInput(order.retarget.nextFollowUpAt) : "");
  const [phone, setPhone] = useState(order.retarget?.phone ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setBusy(true); setError("");
    try {
      await send(`/api/sales/retarget/${order._id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ status, notes, nextFollowUp: followUp || null, phone })
      });
      onSaved();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not save");
    } finally { setBusy(false); }
  }

  return <Modal title={`${order.customer?.name || "Customer"} — ${order.name}`} description="The calling desk's own fields on this order" onClose={onClose}
    footer={<div className="flex gap-2">
      <Button tone="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
      <Button className="flex-1" busy={busy} onClick={save}>Save</Button>
    </div>}>
    <div className="space-y-4">
      <Field label="Status">
        <select className="select" value={status} onChange={event => setStatus(event.target.value as RetargetStatus)}>
          {RETARGET_STATUSES.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </Field>
      <Field label="Follow up on" hint="Leave blank for none.">
        <input className="input" type="date" value={followUp} onChange={event => setFollowUp(event.target.value)} />
      </Field>
      <Field label="Correct phone number" hint={order.customer?.phone ? `The shop has ${order.customer.phone}. Leave blank to use it.` : "The shop has no number for this order."}>
        <input className="input" value={phone} onChange={event => setPhone(event.target.value)} placeholder="+91 98999 43298" />
      </Field>
      <Field label="Note" hint="What to know before dialling. Shown on the row.">
        <textarea className="textarea" rows={2} value={notes} onChange={event => setNotes(event.target.value)} />
      </Field>
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  </Modal>;
}
