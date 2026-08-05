"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, ArrowLeft, Ban, CalendarClock, Download, Phone, Receipt, Trash2, User
} from "lucide-react";
import { Badge, Button, Card, Field, Notice, PageTitle, Spinner, Stat } from "@/components/ui/kit";
import { Modal } from "@/components/ui/modal";
import { PaymentForm } from "@/components/billing/payment-form";
import { invoiceLabel, invoiceTone } from "@/components/billing/invoice-row";
import { formatDate, toDateInput } from "@/lib/time";
import { can, usesFieldPanel, type Role } from "@/constants/access";
import { formatMoney } from "@/lib/billing/constants";
import { amountInWords } from "@/lib/billing/gst";
import type { InvoiceRecord } from "@/lib/billing/types";

/**
 * One bill, in full. The same component in both panels: an administrator and
 * the representative whose bill it is need to see exactly the same figures, and
 * only the actions along the top differ.
 */
export function InvoiceView({ invoiceId, backHref }: { invoiceId: string; backHref: string }) {
  const router = useRouter();
  const [invoice, setInvoice] = useState<InvoiceRecord | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [userId, setUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState("");
  const [paying, setPaying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    const [detail, me] = await Promise.all([
      fetch(`/api/invoices/${invoiceId}`).then(r => r.json()) as Promise<{ error?: string; data?: { invoice: InvoiceRecord } }>,
      fetch("/api/auth/me").then(r => r.json()) as Promise<{ data?: { _id: string; role: Role } }>
    ]);
    if (detail.error || !detail.data?.invoice) { setNotFound(detail.error ?? "This bill could not be found"); setLoading(false); return; }
    setInvoice(detail.data.invoice);
    setRole(me.data?.role ?? null);
    setUserId(String(me.data?._id ?? ""));
    setLoading(false);
  }, [invoiceId]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <Spinner label="Loading the bill…" />;
  if (notFound || !invoice) return <div className="space-y-4">
    <Link href={backHref} className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--brand)]">
      <ArrowLeft size={16} />Back
    </Link>
    <Notice tone="error">{notFound || "This bill could not be found"}</Notice>
  </div>;

  const mayManage = role !== null && can.manageBilling(role);
  const owned = String(invoice.employee?._id ?? "") === userId;
  // The rep collects against their own bills; the administrator against any.
  const mayCollect = role !== null && can.recordPayment(role)
    && (mayManage || (usesFieldPanel(role) && owned))
    && invoice.status !== "Paid" && invoice.status !== "Cancelled";

  const label = invoiceLabel(invoice);

  async function save(patch: Record<string, unknown>, success: string) {
    const response = await fetch(`/api/invoices/${invoiceId}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch)
    });
    const json = await response.json() as { error?: string };
    setNotice(response.ok
      ? { tone: "success", text: success }
      : { tone: "error", text: json.error ?? "Could not save this" });
    if (response.ok) load();
    return response.ok;
  }

  async function remove() {
    if (!window.confirm(`Delete ${invoice!.invoiceNo}? The billed stock goes back to inventory. This cannot be undone.`)) return;
    const response = await fetch(`/api/invoices/${invoiceId}`, { method: "DELETE" });
    const json = await response.json() as { error?: string };
    if (!response.ok) { setNotice({ tone: "error", text: json.error ?? "Could not delete this bill" }); return; }
    router.push(backHref);
    router.refresh();
  }

  return <div className="space-y-5">
    <Link href={backHref} className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--brand)]">
      <ArrowLeft size={16} />Back
    </Link>

    <PageTitle title={invoice.invoiceNo}
      subtitle={`${invoice.taxed ? "Tax invoice" : "Bill of supply"} · ${formatDate(invoice.invoiceDate)}`}
      actions={<>
        {/* Opened in its own tab so the print dialog does not take the app with it. */}
        <a href={`/invoices/${invoiceId}/print?auto=1`} target="_blank" rel="noopener noreferrer"
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-[10px] border border-[var(--line-2)] bg-white px-4 text-sm font-semibold">
          <Download size={16} />Download
        </a>
        {mayCollect && <Button onClick={() => setPaying(true)}>Record payment</Button>}
      </>} />

    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

    {invoice.status === "Cancelled" && (
      <Notice tone="error">
        This bill was cancelled{invoice.cancelledAt ? ` on ${formatDate(invoice.cancelledAt)}` : ""}
        {invoice.cancelReason ? ` — ${invoice.cancelReason}` : ""}. The stock has gone back to inventory.
      </Notice>
    )}

    {label === "Overdue" && (
      <Notice tone="error">
        <span className="flex items-start gap-2">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>Payment was due on {formatDate(invoice.dueDate!)} and {formatMoney(invoice.balanceDue)} is still outstanding.</span>
        </span>
      </Notice>
    )}

    <Card className="grid grid-cols-2 gap-5 p-5 sm:grid-cols-4">
      <Stat label="Total" value={formatMoney(invoice.grandTotal)} />
      <Stat label="Received" value={formatMoney(invoice.amountPaid)} tone="text-emerald-700" />
      <Stat label="Outstanding" value={formatMoney(invoice.balanceDue)}
        tone={invoice.balanceDue > 0 && invoice.status !== "Cancelled" ? "text-amber-700" : undefined} />
      <div className="min-w-0">
        <p className="truncate text-xs text-[var(--muted)]">Status</p>
        <p className="mt-1"><Badge tone={invoiceTone(invoice)}>{label}</Badge></p>
      </div>
    </Card>

    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-3 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">Billed to</h2>
          {invoice.billTo?.type && <Badge tone="info">{invoice.billTo.type}</Badge>}
        </div>
        <div>
          <p className="text-sm font-semibold">{invoice.billTo?.name}</p>
          {invoice.billTo?.clinicName && <p className="text-sm text-[var(--ink-2)]">{invoice.billTo.clinicName}</p>}
          {invoice.billTo?.address && <p className="mt-0.5 text-xs text-[var(--muted)]">{invoice.billTo.address}</p>}
          <p className="text-xs text-[var(--muted)]">
            {[invoice.billTo?.city, invoice.billTo?.pinCode, invoice.billTo?.state].filter(Boolean).join(", ")}
          </p>
          {invoice.billTo?.gstin && <p className="mt-1 text-xs font-semibold">GSTIN {invoice.billTo.gstin}</p>}
          {invoice.billTo?.phone && (
            <a href={`tel:${invoice.billTo.phone}`} className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--brand)]">
              <Phone size={12} />{invoice.billTo.phone}
            </a>
          )}
        </div>
      </Card>

      <Card className="space-y-3 p-5">
        <h2 className="text-sm font-semibold">Collection</h2>
        <div className="space-y-2 text-sm">
          <Detail icon={User} label="Representative"
            value={invoice.employee ? `${invoice.employee.name}${invoice.employee.employeeId ? ` (${invoice.employee.employeeId})` : ""}` : "—"} />
          <Detail icon={CalendarClock} label="Payment due"
            value={invoice.dueDate ? formatDate(invoice.dueDate) : "Not set"} />
          <Detail icon={Phone} label="Follow up on"
            value={invoice.followUpDate ? formatDate(invoice.followUpDate) : "Not set"} />
          {invoice.taxed && (
            <Detail icon={Receipt} label="Supply"
              value={`${invoice.interState ? "Inter-state · IGST" : "Intra-state · CGST + SGST"}${invoice.placeOfSupply?.state ? ` · ${invoice.placeOfSupply.state}` : ""}`} />
          )}
        </div>
        {mayManage && invoice.status !== "Cancelled" && (
          <Button tone="secondary" className="w-full" onClick={() => setEditing(true)}>Change dates and notes</Button>
        )}
      </Card>
    </div>

    <Card className="overflow-hidden">
      <div className="border-b border-[var(--line)] px-5 py-3.5">
        <h2 className="text-sm font-semibold">Products</h2>
      </div>
      <div className="divide-y divide-[var(--line)]">
        {invoice.items.map((item, index) => (
          <div key={index} className="px-5 py-3.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-semibold">{item.name}</p>
              <p className="text-sm font-semibold">{formatMoney(item.total)}</p>
            </div>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              {item.quantity} {item.unit ?? ""} × {formatMoney(item.rate)}
              {item.discount > 0 && ` · less ${formatMoney(item.discount)}${item.discountType === "PERCENT" ? ` (${item.discountValue}%)` : ""}`}
              {invoice.taxed && ` · GST ${item.gstRate}% = ${formatMoney(item.taxAmount)}`}
              {item.hsnCode && ` · HSN ${item.hsnCode}`}
            </p>
          </div>
        ))}
      </div>

      <dl className="space-y-1.5 border-t border-[var(--line)] px-5 py-4 text-sm">
        <Row label="Subtotal" value={invoice.subtotal} />
        {invoice.totalDiscount > 0 && <Row label="Discount" value={-invoice.totalDiscount} />}
        <Row label="Taxable value" value={invoice.taxableValue} />
        {invoice.taxed && !invoice.interState && <>
          <Row label="CGST" value={invoice.cgstTotal} />
          <Row label="SGST" value={invoice.sgstTotal} />
        </>}
        {invoice.taxed && invoice.interState && <Row label="IGST" value={invoice.igstTotal} />}
        {invoice.roundOff !== 0 && <Row label="Round off" value={invoice.roundOff} />}
        <div className="flex items-center justify-between border-t border-[var(--line)] pt-2 text-base font-semibold">
          <dt>Total payable</dt><dd>{formatMoney(invoice.grandTotal)}</dd>
        </div>
        <p className="pt-1 text-xs text-[var(--muted)]">{amountInWords(invoice.grandTotal)}</p>
      </dl>
    </Card>

    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-3.5">
        <h2 className="text-sm font-semibold">Payments</h2>
        {mayCollect && <Button tone="secondary" className="!min-h-[38px] !px-3 text-xs" onClick={() => setPaying(true)}>Record</Button>}
      </div>
      {invoice.payments.length ? (
        <div className="divide-y divide-[var(--line)]">
          {invoice.payments.map(payment => (
            <div key={payment._id} className="flex items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{formatMoney(payment.amount)} · {payment.mode}</p>
                <p className="truncate text-xs text-[var(--muted)]">
                  {[formatDate(payment.paidAt), payment.reference, payment.receivedBy?.name && `received by ${payment.receivedBy.name}`, payment.notes]
                    .filter(Boolean).join(" · ")}
                </p>
              </div>
              {mayManage && (
                <button aria-label="Remove this payment"
                  onClick={async () => {
                    if (!window.confirm(`Remove the ${formatMoney(payment.amount)} receipt? The balance goes back up.`)) return;
                    const response = await fetch(`/api/invoices/${invoiceId}/payments?payment=${payment._id}`, { method: "DELETE" });
                    const json = await response.json() as { error?: string };
                    setNotice(response.ok
                      ? { tone: "success", text: "Receipt removed." }
                      : { tone: "error", text: json.error ?? "Could not remove this receipt" });
                    if (response.ok) load();
                  }}
                  className="grid size-9 shrink-0 place-items-center rounded-lg text-rose-600 hover:bg-rose-50"><Trash2 size={15} /></button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="px-5 py-6 text-center text-sm text-[var(--muted)]">
          Nothing received against this bill yet.
        </p>
      )}
    </Card>

    {(invoice.notes || invoice.terms) && (
      <Card className="space-y-2 p-5 text-sm">
        {invoice.notes && <p><span className="font-semibold">Note: </span>{invoice.notes}</p>}
        {invoice.terms && <p className="whitespace-pre-line text-xs text-[var(--muted)]">{invoice.terms}</p>}
      </Card>
    )}

    {mayManage && (
      <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Corrections</p>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            Cancel keeps the bill and its number in the books. Delete is only for a bill raised in error, before anything
            has been received against it.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {invoice.status !== "Cancelled" && (
            <Button tone="danger" onClick={() => setCancelling(true)}><Ban size={15} />Cancel bill</Button>
          )}
          {!invoice.payments.length && <Button tone="danger" onClick={remove}><Trash2 size={15} />Delete</Button>}
        </div>
      </Card>
    )}

    {paying && <PaymentForm invoiceId={invoiceId} balanceDue={invoice.balanceDue}
      onClose={() => setPaying(false)}
      onSaved={text => { setPaying(false); setNotice({ tone: "success", text }); load(); }} />}

    {editing && <EditDetails invoice={invoice} onClose={() => setEditing(false)}
      onSave={async patch => { if (await save(patch, "Bill updated.")) setEditing(false); }} />}

    {cancelling && <CancelBill invoiceNo={invoice.invoiceNo} onClose={() => setCancelling(false)}
      onConfirm={async reason => {
        if (await save({ cancel: true, cancelReason: reason || undefined }, "Bill cancelled and the stock returned.")) {
          setCancelling(false);
        }
      }} />}
  </div>;
}

function Row({ label, value }: { label: string; value: number }) {
  return <div className="flex items-center justify-between">
    <dt className="text-[var(--muted)]">{label}</dt>
    <dd>{value < 0 ? `− ${formatMoney(Math.abs(value))}` : formatMoney(value)}</dd>
  </div>;
}

function Detail({ icon: Icon, label, value }: {
  icon: React.ComponentType<{ size?: number; className?: string }>; label: string; value: string;
}) {
  return <div className="flex items-start gap-2.5">
    <Icon size={15} className="mt-0.5 shrink-0 text-[var(--muted)]" />
    <div className="min-w-0">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  </div>;
}

function EditDetails({ invoice, onClose, onSave }: {
  invoice: InvoiceRecord; onClose: () => void; onSave: (patch: Record<string, unknown>) => Promise<void>;
}) {
  const [dueDate, setDueDate] = useState(invoice.dueDate ? toDateInput(invoice.dueDate) : "");
  const [followUpDate, setFollowUpDate] = useState(invoice.followUpDate ? toDateInput(invoice.followUpDate) : "");
  const [notes, setNotes] = useState(invoice.notes ?? "");
  const [busy, setBusy] = useState(false);

  return <Modal title="Dates and notes" description="What was billed cannot change; when it is due can."
    onClose={onClose}
    footer={<Button className="w-full" busy={busy} onClick={async () => {
      setBusy(true);
      await onSave({ dueDate: dueDate || null, followUpDate: followUpDate || null, notes });
      setBusy(false);
    }}>{busy ? "Saving…" : "Save"}</Button>}>
    <div className="space-y-4">
      <Field label="Payment due"><input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="input" /></Field>
      <Field label="Follow up on" hint="When the representative should call about it">
        <input type="date" value={followUpDate} onChange={e => setFollowUpDate(e.target.value)} className="input" />
      </Field>
      <Field label="Notes"><textarea value={notes} onChange={e => setNotes(e.target.value)} className="textarea" /></Field>
    </div>
  </Modal>;
}

function CancelBill({ invoiceNo, onClose, onConfirm }: {
  invoiceNo: string; onClose: () => void; onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  return <Modal title={`Cancel ${invoiceNo}`}
    description="The bill keeps its number and stays in the books, marked cancelled. The products go back to inventory."
    onClose={onClose}
    footer={<Button tone="danger" className="w-full" busy={busy}
      onClick={async () => { setBusy(true); await onConfirm(reason.trim()); setBusy(false); }}>
      {busy ? "Cancelling…" : "Cancel this bill"}
    </Button>}>
    <Field label="Reason" hint="Shown on the bill and in the audit trail">
      <textarea value={reason} onChange={e => setReason(e.target.value)} className="textarea"
        placeholder="Wrong doctor, order withdrawn, duplicate…" />
    </Field>
  </Modal>;
}
