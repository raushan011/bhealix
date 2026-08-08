"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { FilePlus2, FileText, IndianRupee, Pencil, Plus, Wallet, X } from "lucide-react";
import { Badge, Button, Card, Field, Notice, Spinner, Stat } from "@/components/ui/kit";
import { Modal } from "@/components/ui/modal";
import { formatMoney } from "@/lib/billing/constants";
import {
  EARNING_HEADS, ESI_WAGE_CEILING, monthLabel, PF_WAGE_CEILING,
  payrollTone, previousMonth, type NamedAmount, type PayrollStatus
} from "@/lib/hr/payroll";

type Revision = {
  _id: string; effectiveFrom: string;
  basic: number; hra: number; conveyance: number; medical: number; special: number;
  otherAllowances: NamedAmount[];
  pfApplicable: boolean; pfOnFullBasic: boolean; esiApplicable: boolean;
  professionalTaxApplicable: boolean; monthlyTds: number; recurringDeductions: NamedAmount[];
  monthlyGross: number; annualGross: number;
  note?: string; createdBy?: { name: string } | null; createdAt?: string;
};

type Slip = { _id: string; month: string; netPay: number; status: PayrollStatus; paidDays: number; divisorDays: number };

/**
 * What one person is paid, and what they have been paid.
 *
 * A salary is held as a series of revisions rather than a figure that gets
 * edited, because "what were they earning last March" is a question an HR desk
 * is asked and must be able to answer. The card shows the one in force, the
 * ones before it, and the payslips that came out of them.
 */
export function SalaryCard({ employeeId, employeeName, canEdit }: {
  employeeId: string; employeeName: string; canEdit: boolean;
}) {
  const [revisions, setRevisions] = useState<Revision[] | null>(null);
  const [payslips, setPayslips] = useState<Slip[]>([]);
  /** Whether the company runs a fund at all — it overrides what a revision says. */
  const [pfEnabled, setPfEnabled] = useState(false);
  const [mayPrepare, setMayPrepare] = useState(false);
  const [editing, setEditing] = useState<Revision | "new" | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    const [salary, slips] = await Promise.all([
      fetch(`/api/hr/salary/${employeeId}`).then(response => response.json()) as
        Promise<{ data?: { items: Revision[]; pfEnabled?: boolean } }>,
      fetch(`/api/hr/payslips?employee=${employeeId}`).then(response => response.json()) as
        Promise<{ data?: { items: Slip[]; mayPrepare?: boolean } }>
    ]);
    setRevisions(salary.data?.items ?? []);
    setPfEnabled(Boolean(salary.data?.pfEnabled));
    setPayslips(slips.data?.items ?? []);
    setMayPrepare(Boolean(slips.data?.mayPrepare));
  }, [employeeId]);
  useEffect(() => { load(); }, [load]);

  if (!revisions) return <Card className="p-5"><Spinner label="Loading the salary record…" /></Card>;

  const current = revisions[0];
  const history = revisions.slice(1);

  async function removeRevision(revision: Revision) {
    if (!window.confirm(`Remove the revision effective ${monthLabel(revision.effectiveFrom)}?`)) return;
    const response = await fetch(`/api/hr/salary/${employeeId}?effectiveFrom=${revision.effectiveFrom}`, { method: "DELETE" });
    const json = await response.json() as { error?: string };
    if (!response.ok) { setNotice({ tone: "error", text: json.error ?? "Could not remove that revision" }); return; }
    setNotice({ tone: "success", text: "Revision removed." });
    load();
  }

  return <Card className="space-y-4 p-5">
    <div className="flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Wallet size={15} className="text-[var(--brand)]" />Salary
      </h2>
      {canEdit && (
        <button onClick={() => setEditing(current ?? "new")} className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand)]">
          {current ? <><Pencil size={12} />Revise</> : <><Plus size={12} />Set a salary</>}
        </button>
      )}
    </div>

    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

    {current ? <>
      <div className="grid grid-cols-2 gap-4 rounded-[10px] bg-[var(--surface-2)] p-4 lg:grid-cols-4">
        <Stat label="Monthly gross" value={formatMoney(current.monthlyGross)} />
        <Stat label="A year" value={formatMoney(current.annualGross)} />
        <Stat label="Basic" value={formatMoney(current.basic)} />
        <div className="min-w-0">
          <p className="truncate text-xs text-[var(--muted)]">In force from</p>
          <p className="mt-0.5 text-sm font-semibold">{monthLabel(current.effectiveFrom)}</p>
        </div>
      </div>

      <dl className="grid gap-1.5 text-sm sm:grid-cols-2">
        {EARNING_HEADS.filter(head => current[head.key] > 0).map(head => (
          <Line key={head.key} label={head.label} value={formatMoney(current[head.key])} />
        ))}
        {current.otherAllowances.map(item => (
          <Line key={item.name} label={item.name} value={formatMoney(item.amount)} />
        ))}
      </dl>

      <div className="flex flex-wrap gap-1.5">
        <Badge tone={pfEnabled && current.pfApplicable ? "info" : "neutral"}>
          {!pfEnabled ? "No provident fund"
            : current.pfApplicable ? (current.pfOnFullBasic ? "PF on the whole basic" : "PF to the ceiling")
              : "Outside the fund"}
        </Badge>
        <Badge tone={current.esiApplicable ? "info" : "neutral"}>
          {current.esiApplicable ? "ESI where eligible" : "ESI not applicable"}
        </Badge>
        <Badge tone={current.professionalTaxApplicable ? "info" : "neutral"}>
          {current.professionalTaxApplicable ? "Professional tax" : "No professional tax"}
        </Badge>
        {current.monthlyTds > 0 && <Badge tone="warn">TDS {formatMoney(current.monthlyTds)}/month</Badge>}
        {current.recurringDeductions.map(item => (
          <Badge key={item.name} tone="warn">{item.name} {formatMoney(item.amount)}/month</Badge>
        ))}
      </div>

      {current.note && <p className="text-xs italic text-[var(--muted)]">“{current.note}”</p>}
    </> : (
      <p className="text-sm text-[var(--muted)]">
        No salary has been set. Until one is, {employeeName.split(" ")[0]} is left out of every payroll month — and the
        run says so rather than paying nothing quietly.
      </p>
    )}

    {history.length > 0 && (
      <div className="border-t border-[var(--line)] pt-3">
        <p className="mb-2 text-xs font-semibold text-[var(--ink-2)]">Earlier revisions</p>
        <ul className="space-y-1.5">
          {history.map(revision => (
            <li key={revision._id} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">
                <span className="font-medium">{monthLabel(revision.effectiveFrom)}</span>
                <span className="text-[var(--muted)]"> · {formatMoney(revision.monthlyGross)} a month</span>
                {revision.note ? <span className="text-[var(--muted)]"> · {revision.note}</span> : null}
              </span>
              {canEdit && (
                <button onClick={() => removeRevision(revision)} aria-label={`Remove the revision from ${revision.effectiveFrom}`}
                  className="shrink-0 text-[var(--muted)] hover:text-[var(--danger-ink)]"><X size={14} /></button>
              )}
            </li>
          ))}
        </ul>
      </div>
    )}

    {(payslips.length > 0 || mayPrepare) && (
      <div className="border-t border-[var(--line)] pt-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-xs font-semibold text-[var(--ink-2)]">Payslips</p>
          {/* The month's run pays everybody and is still the ordinary way. This
              is for the person that run could not pay — a salary set after the
              month was prepared, a joiner added late — where rebuilding the
              whole month would also restate payslips already checked. */}
          {mayPrepare && current && (
            <button onClick={() => setPreparing(true)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand)]">
              <FilePlus2 size={12} />Prepare a payslip
            </button>
          )}
        </div>
        {!payslips.length && (
          <p className="text-sm text-[var(--muted)]">
            None yet. {employeeName.split(" ")[0]} gets one when a month is prepared — or prepare a single month here.
          </p>
        )}
        <ul className="space-y-1.5">
          {payslips.slice(0, 12).map(slip => (
            <li key={slip._id} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">
                <span className="font-medium">{monthLabel(slip.month)}</span>
                <span className="text-[var(--muted)]"> · {formatMoney(slip.netPay)}</span>
                {slip.paidDays < slip.divisorDays && (
                  <span className="text-[var(--muted)]"> · {slip.paidDays} of {slip.divisorDays} days</span>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <Badge tone={payrollTone(slip.status)}>{slip.status}</Badge>
                <Link href={`/payslips/${slip._id}/print`} target="_blank" aria-label={`Open the payslip for ${slip.month}`}
                  className="text-[var(--brand)]"><FileText size={14} /></Link>
              </span>
            </li>
          ))}
        </ul>
      </div>
    )}

    {editing && (
      <ReviseSalary employeeId={employeeId} employeeName={employeeName} from={editing === "new" ? null : editing}
        pfEnabled={pfEnabled} onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); setNotice({ tone: "success", text: "Salary saved." }); load(); }} />
    )}

    {preparing && (
      <PreparePayslip employeeId={employeeId} employeeName={employeeName}
        onClose={() => setPreparing(false)}
        onDone={month => {
          setPreparing(false);
          setNotice({ tone: "success", text: `${monthLabel(month)} prepared. It sits in that month's draft run for approval.` });
          load();
        }} />
    )}
  </Card>;
}

type Preview = {
  month: string;
  payslip: { gross: number; totalDeductions: number; netPay: number; paidDays: number; divisorDays: number; lopDays: number } | null;
  reason: string | null;
  incomplete: boolean;
};

/**
 * One person's payslip for one month, worked out before it is written.
 *
 * The preview is the point. Preparing a payslip on its own steps outside the
 * monthly run, so what it will pay — and how many days it counted — is shown
 * plainly first, along with the reason when the answer is that it cannot.
 */
function PreparePayslip({ employeeId, employeeName, onClose, onDone }: {
  employeeId: string; employeeName: string; onClose: () => void; onDone: (month: string) => void;
}) {
  const [month, setMonth] = useState(previousMonth());
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function send(action: "preview" | "generate") {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/hr/payslips", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ employee: employeeId, month, action })
      });
      const json = await response.json() as { error?: string; data?: Preview };
      if (!response.ok || !json.data) throw new Error(json.error ?? "Could not prepare this payslip");
      if (action === "preview") setPreview(json.data);
      else onDone(month);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not prepare this payslip");
    } finally { setBusy(false); }
  }

  return <Modal title="Prepare a payslip" description={employeeName} onClose={onClose}>
    <div className="space-y-4">
      <Field label="Month" hint="Worked out from this person's attendance and the salary in force that month.">
        <input type="month" value={month} className="input"
          onChange={event => { setMonth(event.target.value); setPreview(null); }} />
      </Field>

      {error && <Notice tone="error">{error}</Notice>}

      {preview && <>
        {preview.incomplete && (
          <Notice tone="warning">
            This month has not ended, so the days still to come are not in these figures.
          </Notice>
        )}
        {preview.reason && <Notice tone="error">{preview.reason}</Notice>}

        {preview.payslip && (
          <Card className="grid grid-cols-2 gap-4 p-4">
            <Stat label="Net pay" value={formatMoney(preview.payslip.netPay)} />
            <Stat label="Gross" value={formatMoney(preview.payslip.gross)} />
            <Stat label="Deductions" value={formatMoney(preview.payslip.totalDeductions)} />
            <Stat label="Paid days" value={`${preview.payslip.paidDays} of ${preview.payslip.divisorDays}`} />
          </Card>
        )}
      </>}

      <Notice tone="info">
        The payslip joins that month&apos;s run and waits there for the administrator&apos;s approval, like every other.
        Preparing the whole month again later replaces it.
      </Notice>

      <div className="flex gap-2">
        <Button tone="secondary" className="flex-1" busy={busy && !preview} onClick={() => send("preview")}>
          {preview ? "Refresh" : "Work it out"}
        </Button>
        <Button className="flex-1" busy={busy} disabled={!preview?.payslip} onClick={() => send("generate")}>
          Generate payslip
        </Button>
      </div>
    </div>
  </Modal>;
}

function Line({ label, value }: { label: string; value: string }) {
  return <div className="flex items-start justify-between gap-3">
    <dt className="shrink-0 text-[var(--muted)]">{label}</dt>
    <dd className="min-w-0 text-right font-medium tabular-nums">{value}</dd>
  </div>;
}

/** The month after the one given — a revision starts where the last one left off. */
function nextMonth(month?: string): string {
  const base = month ? new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1) : new Date();
  const next = new Date(base.getFullYear(), base.getMonth() + (month ? 1 : 0), 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
}

function ReviseSalary({ employeeId, employeeName, from, pfEnabled, onClose, onSaved }: {
  employeeId: string; employeeName: string; from: Revision | null; pfEnabled: boolean;
  onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    effectiveFrom: nextMonth(from?.effectiveFrom),
    basic: from?.basic ?? 0,
    hra: from?.hra ?? 0,
    conveyance: from?.conveyance ?? 0,
    medical: from?.medical ?? 0,
    special: from?.special ?? 0,
    pfApplicable: from?.pfApplicable ?? true,
    pfOnFullBasic: from?.pfOnFullBasic ?? false,
    esiApplicable: from?.esiApplicable ?? true,
    professionalTaxApplicable: from?.professionalTaxApplicable ?? true,
    monthlyTds: from?.monthlyTds ?? 0,
    note: ""
  });
  const [allowances, setAllowances] = useState<NamedAmount[]>(from?.otherAllowances ?? []);
  const [recoveries, setRecoveries] = useState<NamedAmount[]>(from?.recurringDeductions ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const set = (patch: Partial<typeof form>) => setForm(current => ({ ...current, ...patch }));
  const gross = form.basic + form.hra + form.conveyance + form.medical + form.special
    + allowances.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);

  async function save() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/hr/salary/${employeeId}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...form,
          note: form.note || undefined,
          otherAllowances: allowances.filter(item => item.name.trim() && item.amount > 0),
          recurringDeductions: recoveries.filter(item => item.name.trim() && item.amount > 0)
        })
      });
      const json = await response.json() as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "Could not save this salary");
      onSaved();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not save this salary");
      setBusy(false);
    }
  }

  return <Modal title={from ? "Revise salary" : "Set a salary"} description={employeeName} onClose={onClose}
    footer={<Button className="w-full" busy={busy} onClick={save}>
      {busy ? "Saving…" : `Save — ${formatMoney(gross)} a month`}
    </Button>}>
    <div className="space-y-4">
      <Notice tone="info">
        A revision applies from the month you set here forward. Earlier payslips keep the figures they were worked out
        from, so a raise never restates a month already paid.
      </Notice>

      <Field label="In force from" hint="Payroll is monthly, so a mid-month change takes effect the following month.">
        <input type="month" value={form.effectiveFrom} className="input"
          onChange={event => set({ effectiveFrom: event.target.value })} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Basic" hint="The provident fund and gratuity are worked out on this.">
          <input type="number" min={0} value={form.basic} className="input"
            onChange={event => set({ basic: Number(event.target.value) || 0 })} />
        </Field>
        <Field label="House rent allowance">
          <input type="number" min={0} value={form.hra} className="input"
            onChange={event => set({ hra: Number(event.target.value) || 0 })} />
        </Field>
        <Field label="Conveyance allowance">
          <input type="number" min={0} value={form.conveyance} className="input"
            onChange={event => set({ conveyance: Number(event.target.value) || 0 })} />
        </Field>
        <Field label="Medical allowance">
          <input type="number" min={0} value={form.medical} className="input"
            onChange={event => set({ medical: Number(event.target.value) || 0 })} />
        </Field>
      </div>
      <Field label="Special allowance" hint="Ordinarily the balancing figure that brings the gross to what was agreed.">
        <input type="number" min={0} value={form.special} className="input"
          onChange={event => set({ special: Number(event.target.value) || 0 })} />
      </Field>

      <NamedRows label="Other allowances" placeholder="Field allowance"
        rows={allowances} onChange={setAllowances} disabled={busy} />

      <div className="rounded-[10px] bg-[var(--surface-2)] p-3 text-sm">
        <div className="flex justify-between font-semibold">
          <span>Monthly gross</span><span className="tabular-nums">{formatMoney(gross)}</span>
        </div>
        <div className="mt-1 flex justify-between text-[var(--muted)]">
          <span>A year</span><span className="tabular-nums">{formatMoney(gross * 12)}</span>
        </div>
      </div>

      <div className="space-y-2 border-t border-[var(--line)] pt-4">
        <p className="text-[13px] font-medium text-[var(--ink-2)]">Statutory</p>
        {/* The company switch is the real answer, so asking about this person's
            fund while there is no fund would only promise a deduction that
            never comes. What is on the record is kept, ready for the day it
            does. */}
        {pfEnabled ? <>
          <Check label="In the provident fund" checked={form.pfApplicable}
            onChange={value => set({ pfApplicable: value })} />
          {form.pfApplicable && (
            <Check label={`Calculate on the whole basic, not only the first ₹${PF_WAGE_CEILING.toLocaleString("en-IN")}`}
              checked={form.pfOnFullBasic} onChange={value => set({ pfOnFullBasic: value })} />
          )}
        </> : (
          <p className="text-sm text-[var(--muted)]">
            The company is not running a provident fund, so none is deducted from anybody. It is turned on in Payroll
            settings.
          </p>
        )}
        <Check label={`Covered by state insurance where the gross is within ₹${ESI_WAGE_CEILING.toLocaleString("en-IN")}`}
          checked={form.esiApplicable} onChange={value => set({ esiApplicable: value })} />
        <Check label="Liable to professional tax" checked={form.professionalTaxApplicable}
          onChange={value => set({ professionalTaxApplicable: value })} />
      </div>

      <Field label="Income tax a month (TDS)" hint="What their declaration works out to. Left at zero, none is deducted.">
        <input type="number" min={0} value={form.monthlyTds} className="input"
          onChange={event => set({ monthlyTds: Number(event.target.value) || 0 })} />
      </Field>

      <NamedRows label="Standing recoveries" placeholder="Salary advance"
        hint="Deducted in full every month, however short the month was — a loan does not halve because somebody took leave."
        rows={recoveries} onChange={setRecoveries} disabled={busy} />

      <Field label="Why it changed">
        <input value={form.note} className="input" placeholder="Annual revision, promotion, correction…"
          onChange={event => set({ note: event.target.value })} />
      </Field>

      {error && <Notice tone="error">{error}</Notice>}
    </div>
  </Modal>;
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="flex items-start gap-2.5 text-sm">
    <input type="checkbox" checked={checked} className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]"
      onChange={event => onChange(event.target.checked)} />
    <span className="min-w-0">{label}</span>
  </label>;
}

function NamedRows({ label, hint, placeholder, rows, onChange, disabled }: {
  label: string; hint?: string; placeholder: string;
  rows: NamedAmount[]; onChange: (rows: NamedAmount[]) => void; disabled?: boolean;
}) {
  return <div>
    <div className="mb-1.5 flex items-center justify-between">
      <span className="text-[13px] font-medium text-[var(--ink-2)]">{label}</span>
      <button type="button" disabled={disabled} onClick={() => onChange([...rows, { name: "", amount: 0 }])}
        className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand)]"><Plus size={13} />Add</button>
    </div>
    {hint && <p className="mb-1.5 text-xs text-[var(--muted)]">{hint}</p>}
    {rows.length ? (
      <div className="space-y-2">
        {rows.map((row, index) => (
          <div key={index} className="flex items-center gap-2">
            <input value={row.name} placeholder={placeholder} className="input flex-1" aria-label={`${label} name`}
              onChange={event => onChange(rows.map((item, i) => i === index ? { ...item, name: event.target.value } : item))} />
            <div className="relative w-32 shrink-0">
              <IndianRupee size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
              <input type="number" min={0} value={row.amount} className="input pl-7" aria-label={`${label} amount`}
                onChange={event => onChange(rows.map((item, i) => i === index ? { ...item, amount: Number(event.target.value) || 0 } : item))} />
            </div>
            <button type="button" aria-label="Remove" className="tap grid shrink-0 place-items-center rounded-[10px] text-[var(--danger-ink)]"
              onClick={() => onChange(rows.filter((_, i) => i !== index))}><X size={16} /></button>
          </div>
        ))}
      </div>
    ) : <p className="text-sm text-[var(--muted)]">None.</p>}
  </div>;
}
