"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, BadgeCheck, Banknote, FileText, RotateCcw, Trash2 } from "lucide-react";
import { Badge, Button, Card, Field, Notice, PageTitle, Spinner, Stat } from "@/components/ui/kit";
import { Modal } from "@/components/ui/modal";
import { formatMoney } from "@/lib/billing/constants";
import { formatDate, todayIso } from "@/lib/time";
import { monthLabel, PAY_MODES, payrollTone, type PayMode, type PayrollStatus } from "@/lib/hr/payroll";

type Run = {
  _id: string; month: string; status: PayrollStatus; lopBasis: string;
  totals: { employees: number; gross: number; deductions: number; netPay: number; employerCost: number };
  skipped: Array<{ name?: string; employeeId?: string; reason: string }>;
  generatedBy?: { name: string } | null; generatedAt?: string;
  approvedBy?: { name: string } | null; approvedAt?: string;
  paidBy?: { name: string } | null; paymentDate?: string; paymentMode?: string; reference?: string;
  note?: string;
};

type Slip = {
  _id: string; netPay: number; gross: number; totalDeductions: number; costToCompany: number;
  paidDays: number; divisorDays: number; lopDays: number; fullGross: number;
  employee?: { _id: string; name: string; employeeId: string } | null;
  snapshot?: { name?: string; employeeId?: string; designation?: string; department?: string };
};

/** One month of payroll: who is being paid what, and the decision to release it. */
export default function PayrollMonthPage() {
  const id = String(useParams().id ?? "");
  const router = useRouter();
  const [data, setData] = useState<{ run: Run; payslips: Slip[]; mayRun: boolean; mayApprove: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [paying, setPaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(`/api/hr/payroll/${id}`);
    const json = await response.json() as { error?: string; data?: { run: Run; payslips: Slip[]; mayRun: boolean; mayApprove: boolean } };
    if (!response.ok || !json.data) { setError(json.error ?? "That payroll month could not be found"); setLoading(false); return; }
    setData(json.data);
    setLoading(false);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function act(body: Record<string, unknown>, text: string) {
    setBusy(true);
    const response = await fetch(`/api/hr/payroll/${id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
    });
    const json = await response.json() as { error?: string };
    setBusy(false);
    if (!response.ok) { setNotice({ tone: "error", text: json.error ?? "Could not do that" }); return false; }
    setNotice({ tone: "success", text });
    setPaying(false);
    load();
    return true;
  }

  async function remove() {
    if (!window.confirm("Delete this draft and its payslips? It can be prepared again at any time.")) return;
    setBusy(true);
    const response = await fetch(`/api/hr/payroll/${id}`, { method: "DELETE" });
    const json = await response.json() as { error?: string };
    setBusy(false);
    if (!response.ok) { setNotice({ tone: "error", text: json.error ?? "Could not delete this draft" }); return; }
    router.push("/admin/hr/payroll");
  }

  if (loading) return <Spinner label="Loading the month…" />;
  if (error || !data) return <div className="space-y-4">
    <Link href="/admin/hr/payroll" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--brand)]">
      <ArrowLeft size={16} />Payroll
    </Link>
    <Notice tone="error">{error || "That payroll month could not be found"}</Notice>
  </div>;

  const { run, payslips, mayApprove } = data;
  const negative = payslips.filter(slip => slip.netPay < 0);

  return <div className="space-y-5">
    <Link href="/admin/hr/payroll" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--brand)]">
      <ArrowLeft size={16} />Payroll
    </Link>

    <PageTitle title={monthLabel(run.month)}
      subtitle={`${run.totals.employees} employee${run.totals.employees === 1 ? "" : "s"} · a day counted as ${run.lopBasis.toLowerCase()}`}
      actions={<>
        {mayApprove && run.status === "Draft" && (
          <Button busy={busy} onClick={() => act({ action: "approve" }, "This month is approved.")}>
            <BadgeCheck size={16} />Approve
          </Button>
        )}
        {mayApprove && run.status === "Approved" && <>
          <Button tone="secondary" busy={busy} onClick={() => act({ action: "reopen" }, "Reopened as a draft.")}>
            <RotateCcw size={16} />Reopen
          </Button>
          <Button onClick={() => setPaying(true)}><Banknote size={16} />Mark paid</Button>
        </>}
        {mayApprove && run.status === "Draft" && (
          <Button tone="danger" busy={busy} onClick={remove}><Trash2 size={16} />Delete draft</Button>
        )}
      </>} />

    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

    {run.status === "Draft" && (
      <Notice tone="info">
        These figures are still a draft. Prepare the month again after correcting attendance or a salary; approving is
        what freezes them.
      </Notice>
    )}
    {run.status === "Paid" && (
      <Notice tone="success">
        Paid {run.paymentDate ? `on ${formatDate(run.paymentDate)}` : ""}
        {run.paymentMode ? ` by ${run.paymentMode.toLowerCase()}` : ""}
        {run.reference ? ` · ${run.reference}` : ""}
        {run.paidBy ? ` · recorded by ${run.paidBy.name}` : ""}.
      </Notice>
    )}

    {negative.length > 0 && (
      <Notice tone="error">
        {negative.length} payslip{negative.length === 1 ? " has" : "s have"} a net below zero — the deductions came to
        more than the month paid. Check the recoveries set against {negative.map(slip => slip.snapshot?.name).join(", ")}.
      </Notice>
    )}

    <Card className="grid grid-cols-2 gap-5 p-5 sm:grid-cols-5">
      <Stat label="Gross" value={formatMoney(run.totals.gross)} />
      <Stat label="Deductions" value={formatMoney(run.totals.deductions)} />
      <Stat label="Net payable" value={formatMoney(run.totals.netPay)} />
      <Stat label="Cost to company" value={formatMoney(run.totals.employerCost)} />
      <div className="min-w-0">
        <p className="truncate text-xs text-[var(--muted)]">Status</p>
        <p className="mt-1"><Badge tone={payrollTone(run.status)}>{run.status}</Badge></p>
      </div>
    </Card>

    {run.skipped?.length > 0 && (
      <Card className="p-5">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-800">
          <AlertTriangle size={15} />{run.skipped.length} employee{run.skipped.length === 1 ? "" : "s"} left out of this month
        </p>
        <ul className="mt-2 space-y-1 text-sm text-[var(--ink-2)]">
          {run.skipped.map(person => (
            <li key={person.employeeId ?? person.name}>
              <span className="font-medium">{person.name}</span>
              {person.employeeId ? <span className="text-[var(--muted)]"> ({person.employeeId})</span> : null}
              {" — "}{person.reason}
            </li>
          ))}
        </ul>
      </Card>
    )}

    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-3.5">
        <h2 className="text-sm font-semibold">Payslips</h2>
        <span className="text-xs text-[var(--muted)]">{payslips.length}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-[var(--surface-2)] text-left text-xs text-[var(--muted)]">
            <tr>
              <th className="px-5 py-2.5 font-medium">Employee</th>
              <th className="px-5 py-2.5 font-medium">Paid days</th>
              <th className="px-5 py-2.5 text-right font-medium">Gross</th>
              <th className="px-5 py-2.5 text-right font-medium">Deductions</th>
              <th className="px-5 py-2.5 text-right font-medium">Net pay</th>
              <th className="px-5 py-2.5 text-right font-medium">Payslip</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line)]">
            {payslips.map(slip => (
              <tr key={slip._id}>
                <td className="px-5 py-3">
                  <p className="font-medium">{slip.snapshot?.name ?? slip.employee?.name ?? "—"}</p>
                  <p className="text-xs text-[var(--muted)]">
                    {[slip.snapshot?.employeeId, slip.snapshot?.designation].filter(Boolean).join(" · ") || "—"}
                  </p>
                </td>
                <td className="px-5 py-3">
                  {slip.paidDays} <span className="text-[var(--muted)]">of {slip.divisorDays}</span>
                  {slip.lopDays > 0 && <p className="text-xs text-amber-700">{slip.lopDays} lost</p>}
                </td>
                <td className="px-5 py-3 text-right tabular-nums">{formatMoney(slip.gross)}</td>
                <td className="px-5 py-3 text-right tabular-nums">{formatMoney(slip.totalDeductions)}</td>
                <td className={`px-5 py-3 text-right font-semibold tabular-nums ${slip.netPay < 0 ? "text-rose-600" : ""}`}>
                  {formatMoney(slip.netPay)}
                </td>
                <td className="px-5 py-3 text-right">
                  <Link href={`/payslips/${slip._id}/print`} target="_blank"
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--brand)]">
                    <FileText size={13} />Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>

    <p className="text-xs text-[var(--muted)]">
      Prepared {run.generatedAt ? formatDate(run.generatedAt) : "—"}
      {run.generatedBy ? ` by ${run.generatedBy.name}` : ""}
      {run.approvedAt ? ` · approved ${formatDate(run.approvedAt)}${run.approvedBy ? ` by ${run.approvedBy.name}` : ""}` : ""}.
      {run.note ? ` ${run.note}` : ""}
    </p>

    {paying && <MarkPaid busy={busy} onClose={() => setPaying(false)}
      onSubmit={body => act({ action: "pay", ...body }, "Recorded as paid.")} />}
  </div>;
}

function MarkPaid({ busy, onClose, onSubmit }: {
  busy: boolean; onClose: () => void; onSubmit: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const [paymentDate, setPaymentDate] = useState(todayIso());
  const [paymentMode, setPaymentMode] = useState<PayMode>("Bank transfer");
  const [reference, setReference] = useState("");

  return <Modal title="Mark this month paid" description="Recorded against the whole run" onClose={onClose}
    footer={<Button className="w-full" busy={busy}
      onClick={() => onSubmit({ paymentDate, paymentMode, reference: reference || undefined })}>
      Record the payment
    </Button>}>
    <div className="space-y-4">
      <Field label="Payment date">
        <input type="date" value={paymentDate} max={todayIso()} className="input"
          onChange={event => setPaymentDate(event.target.value)} />
      </Field>
      <Field label="Paid by">
        <select value={paymentMode} className="select" onChange={event => setPaymentMode(event.target.value as PayMode)}>
          {PAY_MODES.map(mode => <option key={mode}>{mode}</option>)}
        </select>
      </Field>
      <Field label="Reference (optional)" hint="The bank's batch reference, so a query can be traced later.">
        <input value={reference} className="input" onChange={event => setReference(event.target.value)} />
      </Field>
      <Notice tone="info">Once a month is paid it cannot be reopened. A correction belongs in a later month.</Notice>
    </div>
  </Modal>;
}
