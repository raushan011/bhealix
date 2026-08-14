"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, RotateCcw, Trash2, Wallet } from "lucide-react";
import { Badge, Button, Card, Field, Notice, PageTitle, Spinner, Stat } from "@/components/ui/kit";
import { Modal } from "@/components/ui/modal";
import { formatDate, todayIso } from "@/lib/time";
import { PAYOUT_MODES } from "@/lib/sales/constants";
import { payoutTone, periodLabel } from "@/lib/sales/payouts";
import { formatRupees, type PayoutLineRecord, type PayoutRecord } from "@/lib/sales/types";

type Payload = {
  run: PayoutRecord & { generatedBy?: { name?: string }; approvedBy?: { name?: string }; paidBy?: { name?: string } };
  lines: PayoutLineRecord[];
  mayEdit: boolean;
  mayApprove: boolean;
  mayReopen: boolean;
  mayPay: boolean;
  mayDelete: boolean;
};

/**
 * One payout run: who is being paid, what for, and where it stands.
 *
 * Each rep's line lists the orders behind it, because the first question a rep
 * asks about a figure is which orders made it up — and that list is copied onto
 * the run rather than looked up live, so it still answers correctly after a
 * later refund.
 */
export default function SalesPayoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [adjusting, setAdjusting] = useState<PayoutLineRecord | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(`/api/sales/payouts/${id}`);
    const json = await response.json() as { data?: Payload };
    setData(json.data ?? null);
    setLoading(false);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function act(body: Record<string, unknown>, success: string) {
    setBusy(true); setNotice(null);
    try {
      const response = await fetch(`/api/sales/payouts/${id}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
      });
      const json = await response.json() as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "Could not do that");
      setNotice({ tone: "success", text: success });
      load();
    } catch (problem) {
      setNotice({ tone: "error", text: problem instanceof Error ? problem.message : "Could not do that" });
    } finally { setBusy(false); }
  }

  async function remove() {
    setBusy(true);
    const response = await fetch(`/api/sales/payouts/${id}`, { method: "DELETE" });
    const json = await response.json() as { error?: string };
    if (response.ok) router.push("/admin/sales/payouts");
    else { setNotice({ tone: "error", text: json.error ?? "Could not delete this run" }); setBusy(false); }
  }

  if (loading) return <Spinner label="Loading the payout…" />;
  if (!data) return <Notice tone="error">Could not load this payout run.</Notice>;

  const { run, lines } = data;

  return <div className="space-y-5">
    <Link href="/admin/sales/payouts" className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--ink)]">
      <ArrowLeft size={15} />Payouts
    </Link>

    <PageTitle title={run.payoutNo} subtitle={periodLabel({ from: run.from, to: run.to })}
      actions={<>
        {data.mayApprove && <Button busy={busy} onClick={() => act({ action: "approve" }, `${run.payoutNo} has been approved.`)}><Check size={16} />Approve</Button>}
        {data.mayPay && <Button busy={busy} onClick={() => setPaying(true)}><Wallet size={16} />Mark paid</Button>}
        {data.mayReopen && <Button tone="secondary" busy={busy} onClick={() => act({ action: "reopen" }, `${run.payoutNo} is a draft again.`)}><RotateCcw size={16} />Reopen</Button>}
        {data.mayDelete && <Button tone="danger" busy={busy} onClick={remove}><Trash2 size={16} />Delete</Button>}
      </>} />

    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

    <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
      <div>
        <Badge tone={payoutTone(run.status)}>{run.status}</Badge>
        <p className="mt-1.5 text-xs text-[var(--muted)]">
          {run.generatedBy?.name ? `Prepared by ${run.generatedBy.name}` : "Prepared"}
          {run.generatedAt ? ` on ${formatDate(run.generatedAt)}` : ""}
          {run.approvedBy?.name ? ` · approved by ${run.approvedBy.name}` : ""}
          {run.status === "Paid" && run.paymentDate ? ` · paid ${formatDate(run.paymentDate)} by ${run.paymentMode}` : ""}
          {run.reference ? ` · ${run.reference}` : ""}
        </p>
      </div>
      <p className="text-xs text-[var(--muted)]">Commissions held {run.holdDays} days after delivery</p>
    </Card>

    <Card className="grid grid-cols-2 gap-5 p-5 lg:grid-cols-4">
      <Stat label="Partners" value={run.totals?.reps ?? 0} />
      <Stat label="Orders" value={run.totals?.orders ?? 0} />
      <Stat label="Commission" value={formatRupees(run.totals?.gross ?? 0)} />
      <Stat label="Net payable" value={formatRupees(run.totals?.net ?? 0)} tone="text-[var(--ok-ink)]" />
    </Card>

    {run.status === "Paid" && (
      <Notice tone="info">
        This run has been paid, so it can no longer be changed. A commission that has since gone bad is recovered as a
        negative adjustment on a later run, never by rewriting this one.
      </Notice>
    )}

    {lines.length ? (
      <Card className="divide-y divide-[var(--line)]">
        {lines.map(line => (
          <div key={line._id} className="px-5 py-4">
            <div className="flex flex-wrap items-start gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold">{line.snapshot?.name}</p>
                  <Badge>{line.snapshot?.code}</Badge>
                </div>
                <p className="mt-0.5 text-xs text-[var(--muted)]">
                  {line.orderCount} order{line.orderCount === 1 ? "" : "s"} ·
                  {" "}{line.snapshot?.payMethod === "UPI" && line.snapshot?.upiId
                    ? line.snapshot.upiId
                    : line.snapshot?.bankName
                      ? `${line.snapshot.bankName} ••••${line.snapshot.bankAccountLastFour ?? ""}`
                      : line.snapshot?.payMethod ?? "UPI"}
                </p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {line.orders.map(order => order.name).filter(Boolean).join(", ")}
                </p>
                {line.adjustments?.map(adjustment => (
                  <p key={adjustment.name} className={`mt-0.5 text-xs ${adjustment.amount < 0 ? "text-[var(--danger-ink)]" : "text-[var(--ok-ink)]"}`}>
                    {adjustment.name}: {adjustment.amount < 0 ? "−" : "+"}{formatRupees(Math.abs(adjustment.amount))}
                  </p>
                ))}
                {line.note && <p className="mt-0.5 text-xs text-[var(--muted)]">{line.note}</p>}
              </div>

              <div className="shrink-0 text-right">
                <p className="text-sm font-semibold tabular-nums">{formatRupees(line.net)}</p>
                {line.net !== line.gross && (
                  <p className="text-xs text-[var(--muted)] line-through tabular-nums">{formatRupees(line.gross)}</p>
                )}
                {data.mayEdit && (
                  <button onClick={() => setAdjusting(line)} className="mt-1 text-xs font-medium text-[var(--brand)] hover:underline">
                    Adjust
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </Card>
    ) : (
      <Notice tone="warning">
        This run claimed nothing. Either no commission had matured for the period, or another draft took them first.
      </Notice>
    )}

    {paying && <MarkPaid payoutNo={run.payoutNo} onClose={() => setPaying(false)}
      onDone={payment => { setPaying(false); act({ action: "pay", ...payment }, `${run.payoutNo} has been marked paid.`); }} />}

    {adjusting && <AdjustLine line={adjusting} onClose={() => setAdjusting(null)}
      onDone={(adjustments, note) => {
        setAdjusting(null);
        act({ action: "adjust", line: adjusting._id, adjustments, note }, `${adjusting.snapshot?.name}'s line has been adjusted.`);
      }} />}
  </div>;
}

function MarkPaid({ payoutNo, onClose, onDone }: {
  payoutNo: string;
  onClose: () => void;
  onDone: (payment: { paymentDate: string; paymentMode: string; reference?: string }) => void;
}) {
  const [paymentDate, setPaymentDate] = useState(todayIso());
  const [paymentMode, setPaymentMode] = useState<string>("UPI");
  const [reference, setReference] = useState("");

  return <Modal title={`Mark ${payoutNo} paid`} description="Recorded as the day the money actually left" onClose={onClose}
    footer={<div className="flex gap-2">
      <Button tone="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
      <Button className="flex-1" onClick={() => onDone({ paymentDate, paymentMode, reference: reference || undefined })}>Mark paid</Button>
    </div>}>
    <div className="space-y-4">
      <Field label="Paid on"><input className="input" type="date" value={paymentDate} onChange={event => setPaymentDate(event.target.value)} /></Field>
      <Field label="How">
        <select className="select" value={paymentMode} onChange={event => setPaymentMode(event.target.value)}>
          {PAYOUT_MODES.map(mode => <option key={mode} value={mode}>{mode}</option>)}
        </select>
      </Field>
      <Field label="Reference" hint="UTR, transaction id — whatever a partner would quote back to you.">
        <input className="input" value={reference} onChange={event => setReference(event.target.value)} />
      </Field>
      <Notice tone="warning">Once a run is paid it can never be reopened. Corrections go on a later run.</Notice>
    </div>
  </Modal>;
}

/**
 * Adjusting one rep's line.
 *
 * Signed, and named. A recovery for a kit that came back after the last run is a
 * line saying so, not a quietly smaller total — the rep will ask, and somebody
 * has to be able to answer.
 */
function AdjustLine({ line, onClose, onDone }: {
  line: PayoutLineRecord;
  onClose: () => void;
  onDone: (adjustments: { name: string; amount: number }[], note?: string) => void;
}) {
  const [rows, setRows] = useState<{ name: string; amount: string }[]>(
    line.adjustments?.length ? line.adjustments.map(entry => ({ name: entry.name, amount: String(entry.amount) })) : [{ name: "", amount: "" }]
  );
  const [note, setNote] = useState(line.note ?? "");

  const parsed = rows
    .filter(row => row.name.trim() && row.amount.trim())
    .map(row => ({ name: row.name.trim(), amount: Number(row.amount) || 0 }));
  const net = line.gross + parsed.reduce((total, row) => total + row.amount, 0);

  return <Modal title={`Adjust ${line.snapshot?.name}`}
    description={`Commission of ${formatRupees(line.gross)} across ${line.orderCount} order${line.orderCount === 1 ? "" : "s"}`}
    onClose={onClose}
    footer={<div className="flex gap-2">
      <Button tone="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
      <Button className="flex-1" onClick={() => onDone(parsed, note || undefined)}>Save adjustment</Button>
    </div>}>

    <div className="space-y-4">
      {rows.map((row, index) => (
        <div key={index} className="grid grid-cols-[1fr_110px] gap-2">
          <input className="input" placeholder="Kit returned after the last run" value={row.name}
            onChange={event => setRows(current => current.map((entry, at) => at === index ? { ...entry, name: event.target.value } : entry))} />
          <input className="input" type="number" placeholder="−450" value={row.amount}
            onChange={event => setRows(current => current.map((entry, at) => at === index ? { ...entry, amount: event.target.value } : entry))} />
        </div>
      ))}

      <button onClick={() => setRows(current => [...current, { name: "", amount: "" }])}
        className="text-sm font-medium text-[var(--brand)] hover:underline">Add another</button>

      <Field label="Note"><textarea className="textarea" rows={2} value={note} onChange={event => setNote(event.target.value)} /></Field>

      <Card className="flex items-center justify-between p-4">
        <span className="text-sm text-[var(--muted)]">Net payable</span>
        <span className="text-base font-semibold tabular-nums">{formatRupees(net)}</span>
      </Card>
      <p className="text-xs text-[var(--muted)]">Use a negative amount to recover money. A positive one is a bonus.</p>
    </div>
  </Modal>;
}
