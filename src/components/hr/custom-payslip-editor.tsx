"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDown, ArrowLeft, ArrowUp, Copy, Download, FileText, Plus, Printer, RotateCcw, Save, Trash2, X
} from "lucide-react";
import { Badge, Button, Card, Field, Notice, Spinner } from "@/components/ui/kit";
import { PayslipDocument } from "@/components/hr/payslip-document";
import { formatMoney } from "@/lib/billing/constants";
import { monthLabel, PAY_MODES, previousMonth, type NamedAmount } from "@/lib/hr/payroll";
import {
  customTotals, customToSheet, detailsFromEmployee,
  type CustomPayslipDoc, type DetailLine
} from "@/lib/hr/custom-payslip";

type Employee = { _id: string; name: string; employeeId: string; designation?: string; active: boolean };

type Props = {
  /** Editing an existing sheet, or writing a new one when absent. */
  id?: string;
  /** Start from a copy of another sheet — "same again for next month". */
  copyOf?: string;
};

const PRESETS: Array<{ label: string; title: string; hint: string }> = [
  { label: "Payslip", title: "Payslip", hint: "An ordinary month, written by hand" },
  { label: "Arrears", title: "Arrears payslip", hint: "A back-payment on its own sheet" },
  { label: "Bonus", title: "Bonus payslip", hint: "A festival or performance bonus" },
  { label: "Full & final", title: "Full and final settlement", hint: "Everything owed at leaving" },
  { label: "Duplicate", title: "Payslip", hint: "Marked DUPLICATE across the sheet" },
  { label: "Contractor", title: "Payment advice", hint: "A fee to somebody not on the rolls" }
];

/**
 * The custom payslip editor: a form on the left and the sheet it will print on
 * the right, redrawn on every keystroke.
 *
 * Nothing on the sheet is out of reach. The employee block is a list of lines
 * the administrator can add to, reorder or delete; earnings, deductions and
 * the employer's share are whatever rows are typed; the net can be worked out
 * or set by hand; the title, the period, the note, the footer, the watermark
 * and the company's own name are all fields. Prefilling from an employee's
 * record or from a month the payroll run has worked out is a starting point,
 * never a constraint — every line it fills can then be changed.
 */
export function CustomPayslipEditor({ id, copyOf }: Props) {
  const router = useRouter();
  const [form, setForm] = useState<CustomPayslipDoc | null>(null);
  const [saved, setSaved] = useState<CustomPayslipDoc | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loadMonth, setLoadMonth] = useState(previousMonth());
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [error, setError] = useState("");

  // ------------------------------------------------------------------ loading
  useEffect(() => {
    let cancelled = false;
    async function start() {
      const source = id ?? copyOf;
      const url = source ? `/api/hr/custom-payslips/${source}` : "/api/hr/custom-payslips?blank=1";
      const [sheet, team] = await Promise.all([
        fetch(url).then(response => response.json()) as Promise<{ error?: string; data?: { item?: CustomPayslipDoc; blank?: CustomPayslipDoc } }>,
        fetch("/api/team?active=all").then(response => response.json()) as Promise<{ data?: { items: Employee[] } }>
      ]);
      if (cancelled) return;
      const doc = sheet.data?.item ?? sheet.data?.blank;
      if (!doc) { setError(sheet.error ?? "That payslip could not be found"); return; }
      const clean = normalise(doc);
      if (copyOf && !id) {
        // A copy is a new draft with the old sheet's contents — never the old sheet's identity.
        delete clean._id; clean.status = "Draft"; clean.createdBy = null; clean.createdAt = undefined; clean.updatedAt = undefined;
      }
      setForm(clean);
      setSaved(id ? clean : null);
      setEmployees(team.data?.items ?? []);
    }
    start();
    return () => { cancelled = true; };
  }, [id, copyOf]);

  const set = useCallback((patch: Partial<CustomPayslipDoc>) => {
    setForm(current => current ? { ...current, ...patch } : current);
    setDirty(true);
  }, []);

  const totals = useMemo(() => form ? customTotals(form) : null, [form]);
  const sheet = useMemo(() => form ? customToSheet(form) : null, [form]);

  // ------------------------------------------------------------- prefilling
  /** Fills the employee block from somebody's record. Their lines replace the block; the figures are untouched. */
  async function pickEmployee(employeeId: string) {
    if (!form) return;
    if (!employeeId) { set({ employee: null, employeeName: "" }); return; }
    const chosen = employees.find(person => person._id === employeeId);
    set({ employee: employeeId, employeeName: chosen?.name ?? "" });
    const response = await fetch(`/api/team/${employeeId}`);
    const json = await response.json() as { data?: { employee: Parameters<typeof detailsFromEmployee>[0] } };
    if (json.data?.employee) set({ details: detailsFromEmployee(json.data.employee) });
  }

  /**
   * Copies a month's figures in from the payroll run — the slip already issued
   * for that month if there is one, else what the run would work out today.
   * The lines land in the editor as ordinary rows and can be changed after.
   */
  async function loadFigures() {
    if (!form?.employee) { setNotice({ tone: "error", text: "Choose an employee first." }); return; }
    setBusy(true); setNotice(null);
    try {
      type Slip = {
        earnings: NamedAmount[]; deductions: NamedAmount[]; employerContributions?: NamedAmount[];
        daysInMonth: number; divisorDays: number; paidDays: number; lopDays: number; roundOff: number;
        snapshot?: Parameters<typeof detailsFromEmployee>[0] & { bankAccountLastFour?: string };
      };
      let slip: Slip | null = null;
      let origin = "";
      const existing = await fetch(`/api/hr/payslips?employee=${form.employee}&month=${loadMonth}`).then(r => r.json()) as
        { data?: { items: Slip[] } };
      if (existing.data?.items?.length) { slip = existing.data.items[0]; origin = "the payslip already issued"; }
      else {
        const preview = await fetch("/api/hr/payslips", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ employee: form.employee, month: loadMonth, action: "preview" })
        }).then(r => r.json()) as { error?: string; data?: { payslip: Slip | null; reason?: string | null } };
        if (preview.data?.payslip) { slip = preview.data.payslip; origin = "what the payroll run works out"; }
        else throw new Error(preview.data?.reason ?? preview.error ?? "Nothing could be worked out for that month");
      }
      set({
        month: loadMonth,
        periodLabel: monthLabel(loadMonth),
        earnings: slip.earnings.map(row => ({ ...row })),
        deductions: slip.deductions.map(row => ({ ...row })),
        employerContributions: (slip.employerContributions ?? []).map(row => ({ ...row })),
        attendance: {
          show: true, daysInMonth: slip.daysInMonth, divisorDays: slip.divisorDays,
          paidDays: slip.paidDays, lopDays: slip.lopDays
        },
        roundOff: slip.roundOff ?? 0,
        netPayMode: "computed"
      });
      setNotice({ tone: "success", text: `Loaded ${monthLabel(loadMonth)} from ${origin}. Every line can still be changed.` });
    } catch (problem) {
      setNotice({ tone: "error", text: problem instanceof Error ? problem.message : "Could not load that month" });
    } finally { setBusy(false); }
  }

  // ---------------------------------------------------------------- saving
  async function save(status?: CustomPayslipDoc["status"]) {
    if (!form) return;
    setBusy(true); setNotice(null);
    const body = { ...toInput(form), status: status ?? form.status };
    try {
      const response = await fetch(id ? `/api/hr/custom-payslips/${id}` : "/api/hr/custom-payslips", {
        method: id ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
      });
      const json = await response.json() as { error?: string; data?: { item: CustomPayslipDoc } };
      if (!response.ok || !json.data) throw new Error(json.error ?? "Could not save this payslip");
      const stored = normalise(json.data.item);
      setDirty(false);
      if (!id) { router.replace(`/admin/hr/payroll/custom/${stored._id}`); return; }
      setForm(stored); setSaved(stored);
      setNotice({ tone: "success", text: status === "Issued" ? "Saved and marked issued." : "Saved." });
    } catch (problem) {
      setNotice({ tone: "error", text: problem instanceof Error ? problem.message : "Could not save this payslip" });
    } finally { setBusy(false); }
  }

  async function remove() {
    if (!id || !window.confirm("Delete this custom payslip? This cannot be undone.")) return;
    setBusy(true);
    const response = await fetch(`/api/hr/custom-payslips/${id}`, { method: "DELETE" });
    const json = await response.json() as { error?: string };
    setBusy(false);
    if (!response.ok) { setNotice({ tone: "error", text: json.error ?? "Could not delete this payslip" }); return; }
    router.push("/admin/hr/payroll/custom");
  }

  // --------------------------------------------------------------- rendering
  if (error) return <div className="space-y-4">
    <BackLink />
    <Notice tone="error">{error}</Notice>
  </div>;
  if (!form || !sheet || !totals) return <Spinner label="Opening the editor…" />;

  const applyPreset = (preset: (typeof PRESETS)[number]) => {
    const patch: Partial<CustomPayslipDoc> = { title: preset.title };
    if (preset.label === "Duplicate") patch.watermark = "Duplicate";
    if (preset.label === "Contractor") { patch.attendance = { ...form.attendance, show: false }; patch.employerContributions = []; }
    if (preset.label === "Full & final") patch.periodLabel = form.periodLabel || "Full and final settlement";
    set(patch);
  };

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <BackLink />
      <div className="flex flex-wrap items-center gap-2">
        {id && <>
          <Link href={`/admin/hr/payroll/custom/new?copy=${id}`}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-[10px] border border-[var(--line-2)] bg-[var(--surface)] px-3 text-sm font-semibold">
            <Copy size={15} />Copy as new
          </Link>
          <a href={`/payslips/custom/${id}/print`} target="_blank" rel="noreferrer"
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-[10px] border border-[var(--line-2)] bg-[var(--surface)] px-3 text-sm font-semibold"
            title={dirty ? "Save first — the print shows what is saved" : "Open the printable sheet"}>
            <Printer size={15} />Print / PDF
          </a>
          <Button tone="danger" busy={busy} onClick={remove}><Trash2 size={15} />Delete</Button>
        </>}
        <Button tone="secondary" busy={busy} onClick={() => save()}><Save size={15} />{id ? "Save" : "Save draft"}</Button>
        <Button busy={busy} onClick={() => save("Issued")}><Download size={15} />Save &amp; issue</Button>
      </div>
    </div>

    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">{id ? "Custom payslip" : "New custom payslip"}</h1>
        <Badge tone={form.status === "Issued" ? "success" : "neutral"}>{form.status}</Badge>
        {dirty && <Badge tone="warn">Unsaved changes</Badge>}
      </div>
      <p className="mt-0.5 text-sm text-[var(--muted)]">
        Every line on the sheet is yours to write. The preview on the right is exactly what prints.
      </p>
    </div>

    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

    <div className="grid gap-5 xl:grid-cols-[minmax(0,460px)_minmax(0,1fr)]">
      {/* ------------------------------------------------------------ form */}
      <div className="space-y-4">
        <Card className="space-y-4 p-5">
          <h2 className="text-sm font-semibold">What kind of sheet</h2>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map(preset => (
              <button key={preset.label} type="button" title={preset.hint} onClick={() => applyPreset(preset)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${form.title === preset.title && (preset.label !== "Duplicate" || form.watermark)
                  ? "border-[var(--brand)] bg-[var(--brand)] text-white"
                  : "border-[var(--line-2)] bg-[var(--surface)] text-[var(--ink-2)]"}`}>
                {preset.label}
              </button>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Title" hint="Printed across the top of the sheet.">
              <input value={form.title} className="input" maxLength={60} onChange={event => set({ title: event.target.value })} />
            </Field>
            <Field label="Period" hint="Anything: a month, a fortnight, “Full and final”.">
              <input value={form.periodLabel} className="input" maxLength={80} placeholder="August 2026"
                onChange={event => set({ periodLabel: event.target.value })} />
            </Field>
            <Field label="Month on record" hint="Optional — so the sheet is filed against a month.">
              <input type="month" value={form.month ?? ""} className="input"
                onChange={event => set({ month: event.target.value, periodLabel: form.periodLabel || (event.target.value ? monthLabel(event.target.value) : "") })} />
            </Field>
            <Field label="Watermark" hint="Faint text across the sheet — DUPLICATE, COPY, SPECIMEN.">
              <input value={form.watermark} className="input" maxLength={30} onChange={event => set({ watermark: event.target.value })} />
            </Field>
          </div>
          <label className="flex items-start gap-2.5 text-sm">
            <input type="checkbox" checked={form.showDraftMark} className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]"
              onChange={event => set({ showDraftMark: event.target.checked })} />
            <span>Print a red “Draft — not yet approved” mark under the title</span>
          </label>
        </Card>

        <Card className="space-y-4 p-5">
          <h2 className="text-sm font-semibold">Who it is for</h2>
          <Field label="Employee" hint="Fills the block below from their record. Leave blank for somebody not on the rolls.">
            <select value={form.employee ?? ""} className="select" onChange={event => pickEmployee(event.target.value)}>
              <option value="">— Not linked to an employee —</option>
              {employees.map(person => (
                <option key={person._id} value={person._id}>
                  {person.name} · {person.employeeId}{person.active ? "" : " (inactive)"}
                </option>
              ))}
            </select>
          </Field>
          {form.employee && (
            <div className="flex flex-wrap items-end gap-2 rounded-[10px] border border-[var(--line)] bg-[var(--surface-2)] p-3">
              <Field label="Load figures from a payroll month">
                <input type="month" value={loadMonth} className="input" onChange={event => setLoadMonth(event.target.value)} />
              </Field>
              <Button tone="secondary" busy={busy} onClick={loadFigures}><FileText size={15} />Load figures</Button>
              <p className="basis-full text-xs text-[var(--muted)]">
                Copies that month&apos;s earnings, deductions and days in as editable rows.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-[13px] font-medium text-[var(--ink-2)]">Lines in the employee block</p>
            {form.details.map((line, index) => (
              <div key={index} className="flex items-center gap-1.5">
                <input value={line.label} placeholder="Label" className="input w-[38%] shrink-0" maxLength={40}
                  onChange={event => set({ details: patchAt(form.details, index, { label: event.target.value }) })} />
                <input value={line.value} placeholder="Value" className="input min-w-0 flex-1" maxLength={120}
                  onChange={event => set({ details: patchAt(form.details, index, { value: event.target.value }) })} />
                <RowTools index={index} count={form.details.length}
                  onMove={to => set({ details: moveRow(form.details, index, to) })}
                  onRemove={() => set({ details: form.details.filter((_, i) => i !== index) })} />
              </div>
            ))}
            <AddRow label="Add a line" disabled={form.details.length >= 24}
              onClick={() => set({ details: [...form.details, { label: "", value: "" }] })} />
          </div>
        </Card>

        <Card className="space-y-4 p-5">
          <h2 className="text-sm font-semibold">Days</h2>
          <label className="flex items-start gap-2.5 text-sm">
            <input type="checkbox" checked={form.attendance.show} className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]"
              onChange={event => set({ attendance: { ...form.attendance, show: event.target.checked } })} />
            <span>Show days on the sheet</span>
          </label>
          {form.attendance.show && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {([["daysInMonth", "In month"], ["divisorDays", "Divisor"], ["paidDays", "Paid"], ["lopDays", "Loss of pay"]] as const).map(([key, label]) => (
                <Field key={key} label={label}>
                  <input type="number" min={0} max={366} value={form.attendance[key]} className="input"
                    onChange={event => set({ attendance: { ...form.attendance, [key]: Number(event.target.value) || 0 } })} />
                </Field>
              ))}
            </div>
          )}
        </Card>

        <AmountRows title="Earnings" rows={form.earnings} total={totals.gross} totalLabel="Gross"
          onChange={earnings => set({ earnings })} suggestions={["Basic", "House rent allowance", "Conveyance", "Medical allowance", "Special allowance", "Arrears", "Bonus", "Incentive", "Overtime", "Leave encashment", "Gratuity", "Notice pay"]} />
        <AmountRows title="Deductions" rows={form.deductions} total={totals.totalDeductions} totalLabel="Total deductions"
          onChange={deductions => set({ deductions })} suggestions={["Provident fund", "ESI", "Professional tax", "TDS", "Advance recovery", "Loan recovery", "Notice period recovery", "Loss of pay"]} />
        <AmountRows title="Paid by the company on your behalf" rows={form.employerContributions}
          onChange={employerContributions => set({ employerContributions })}
          suggestions={["Employer PF", "Employer ESI", "Gratuity provision"]}
          extra={<Field label="Heading over this section">
            <input value={form.employerContributionsNote} className="input" maxLength={160}
              onChange={event => set({ employerContributionsNote: event.target.value })} />
          </Field>} />

        <Card className="space-y-4 p-5">
          <h2 className="text-sm font-semibold">Net pay</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Worked out how">
              <select value={form.netPayMode} className="select"
                onChange={event => set({ netPayMode: event.target.value as CustomPayslipDoc["netPayMode"] })}>
                <option value="computed">Gross − deductions ± rounding</option>
                <option value="manual">A figure I set</option>
              </select>
            </Field>
            {form.netPayMode === "computed" ? (
              <Field label="Rounding" hint="Added to the net; use a minus to round down.">
                <input type="number" step={1} value={form.roundOff} className="input"
                  onChange={event => set({ roundOff: Number(event.target.value) || 0 })} />
              </Field>
            ) : (
              <Field label="Net pay" hint={`Gross − deductions comes to ${formatMoney(totals.netPayable)}.`}>
                <input type="number" step={1} value={form.netPayOverride} className="input"
                  onChange={event => set({ netPayOverride: Number(event.target.value) || 0 })} />
              </Field>
            )}
          </div>
          <div className="flex items-baseline justify-between rounded-[10px] bg-[var(--surface-2)] px-4 py-2.5">
            <span className="text-sm font-semibold">Net pay on the sheet</span>
            <span className={`text-lg font-semibold tabular-nums ${totals.netPay < 0 ? "text-[var(--danger-ink)]" : ""}`}>{formatMoney(totals.netPay)}</span>
          </div>
          <label className="flex items-start gap-2.5 text-sm">
            <input type="checkbox" checked={form.showAmountInWords} className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]"
              onChange={event => set({ showAmountInWords: event.target.checked })} />
            <span>Print the net in words</span>
          </label>
        </Card>

        <Card className="space-y-4 p-5">
          <h2 className="text-sm font-semibold">Payment and signature</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Paid on">
              <input type="date" value={form.paymentDate ?? ""} className="input" onChange={event => set({ paymentDate: event.target.value })} />
            </Field>
            <Field label="Paid by">
              <select value={form.paymentMode ?? ""} className="select" onChange={event => set({ paymentMode: event.target.value })}>
                <option value="">—</option>
                {PAY_MODES.map(mode => <option key={mode}>{mode}</option>)}
              </select>
            </Field>
            <Field label="Reference">
              <input value={form.reference ?? ""} className="input" maxLength={120} onChange={event => set({ reference: event.target.value })} />
            </Field>
          </div>
          <Field label="Signatory" hint="A signature line is printed when this is filled.">
            <input value={form.signatoryName} className="input" maxLength={80} onChange={event => set({ signatoryName: event.target.value })} />
          </Field>
        </Card>

        <Card className="space-y-4 p-5">
          <h2 className="text-sm font-semibold">Company and wording</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Company name">
              <input value={form.company.name} className="input" maxLength={120}
                onChange={event => set({ company: { ...form.company, name: event.target.value } })} />
            </Field>
            <Field label="Employer PAN">
              <input value={form.company.pan} className="input" maxLength={20}
                onChange={event => set({ company: { ...form.company, pan: event.target.value } })} />
            </Field>
          </div>
          <Field label="Address">
            <input value={form.company.address} className="input" maxLength={300}
              onChange={event => set({ company: { ...form.company, address: event.target.value } })} />
          </Field>
          <Field label="Note under the totals" hint="What this sheet is for — an arrear for which months, a settlement of what.">
            <textarea value={form.note} className="input min-h-[72px]" maxLength={600} onChange={event => set({ note: event.target.value })} />
          </Field>
          <Field label="Footer line" hint="Replaces “This is a computer-generated payslip…” when filled.">
            <input value={form.footerText} className="input" maxLength={400} onChange={event => set({ footerText: event.target.value })} />
          </Field>
        </Card>

        {saved && dirty && (
          <button type="button" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--brand)]"
            onClick={() => { setForm(saved); setDirty(false); }}>
            <RotateCcw size={14} />Discard changes since the last save
          </button>
        )}
      </div>

      {/* --------------------------------------------------------- preview */}
      <div className="min-w-0">
        <div className="xl:sticky xl:top-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Preview</p>
          <div className="overflow-x-auto rounded-[12px] border border-[var(--line)] bg-neutral-200 p-3 sm:p-5">
            <PayslipDocument payslip={sheet.payslip} company={sheet.company} meta={sheet.meta} custom={sheet.custom} />
          </div>
        </div>
      </div>
    </div>
  </div>;
}

// -------------------------------------------------------------------- pieces

function BackLink() {
  return <Link href="/admin/hr/payroll/custom" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--brand)]">
    <ArrowLeft size={16} />Custom payslips
  </Link>;
}

function AddRow({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return <button type="button" disabled={disabled} onClick={onClick}
    className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand)] disabled:opacity-50">
    <Plus size={13} />{label}
  </button>;
}

function RowTools({ index, count, onMove, onRemove }: {
  index: number; count: number; onMove: (to: number) => void; onRemove: () => void;
}) {
  const tool = "tap grid size-8 shrink-0 place-items-center rounded-[8px] text-[var(--muted)] disabled:opacity-30";
  return <div className="flex shrink-0 items-center">
    <button type="button" aria-label="Move up" className={tool} disabled={index === 0} onClick={() => onMove(index - 1)}><ArrowUp size={14} /></button>
    <button type="button" aria-label="Move down" className={tool} disabled={index === count - 1} onClick={() => onMove(index + 1)}><ArrowDown size={14} /></button>
    <button type="button" aria-label="Remove" className={`${tool} text-[var(--danger-ink)]`} onClick={onRemove}><X size={15} /></button>
  </div>;
}

/** One column of the sheet: named rows with amounts, a total underneath, and a few common names to add in a click. */
function AmountRows({ title, rows, total, totalLabel, onChange, suggestions, extra }: {
  title: string; rows: NamedAmount[]; total?: number; totalLabel?: string;
  onChange: (rows: NamedAmount[]) => void; suggestions: string[]; extra?: React.ReactNode;
}) {
  const unused = suggestions.filter(name => !rows.some(row => row.name.toLowerCase() === name.toLowerCase()));
  return <Card className="space-y-3 p-5">
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      {total !== undefined && <span className="text-xs text-[var(--muted)]">{totalLabel} <span className="font-semibold tabular-nums text-[var(--ink)]">{formatMoney(total)}</span></span>}
    </div>
    {extra}
    {rows.map((row, index) => (
      <div key={index} className="flex items-center gap-1.5">
        <input value={row.name} placeholder="Name" className="input min-w-0 flex-1" maxLength={60}
          onChange={event => onChange(patchAt(rows, index, { name: event.target.value }))} />
        <input type="number" step={1} value={row.amount} className="input w-32 shrink-0 text-right tabular-nums"
          onChange={event => onChange(patchAt(rows, index, { amount: Number(event.target.value) || 0 }))} />
        <RowTools index={index} count={rows.length}
          onMove={to => onChange(moveRow(rows, index, to))}
          onRemove={() => onChange(rows.filter((_, i) => i !== index))} />
      </div>
    ))}
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <AddRow label="Add a row" disabled={rows.length >= 30} onClick={() => onChange([...rows, { name: "", amount: 0 }])} />
      {unused.length > 0 && rows.length < 30 && (
        <span className="flex flex-wrap gap-1">
          {unused.map(name => (
            <button key={name} type="button" onClick={() => onChange([...rows, { name, amount: 0 }])}
              className="rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-2 py-0.5 text-[11px] text-[var(--ink-2)]">
              + {name}
            </button>
          ))}
        </span>
      )}
    </div>
  </Card>;
}

// ------------------------------------------------------------------- helpers

function patchAt<T>(rows: T[], index: number, patch: Partial<T>): T[] {
  return rows.map((row, i) => i === index ? { ...row, ...patch } : row);
}

function moveRow<T>(rows: T[], from: number, to: number): T[] {
  if (to < 0 || to >= rows.length) return rows;
  const next = rows.slice();
  const [row] = next.splice(from, 1);
  next.splice(to, 0, row);
  return next;
}

/** A stored document, with every optional field present so the inputs are always controlled. */
function normalise(doc: CustomPayslipDoc): CustomPayslipDoc {
  const employee = doc.employee && typeof doc.employee === "object" ? String((doc.employee as { _id: unknown })._id) : doc.employee ?? null;
  return {
    ...doc,
    _id: doc._id ? String(doc._id) : undefined,
    employee,
    employeeName: doc.employeeName ?? "",
    month: doc.month ?? "",
    company: { name: doc.company?.name ?? "", address: doc.company?.address ?? "", pan: doc.company?.pan ?? "" },
    details: (doc.details ?? []).map((line: DetailLine) => ({ label: line.label ?? "", value: line.value ?? "" })),
    attendance: {
      show: doc.attendance?.show ?? true, daysInMonth: doc.attendance?.daysInMonth ?? 0,
      divisorDays: doc.attendance?.divisorDays ?? 0, paidDays: doc.attendance?.paidDays ?? 0, lopDays: doc.attendance?.lopDays ?? 0
    },
    earnings: doc.earnings ?? [], deductions: doc.deductions ?? [], employerContributions: doc.employerContributions ?? [],
    employerContributionsNote: doc.employerContributionsNote ?? "",
    netPayMode: doc.netPayMode ?? "computed", netPayOverride: doc.netPayOverride ?? 0, roundOff: doc.roundOff ?? 0,
    showAmountInWords: doc.showAmountInWords ?? true,
    paymentDate: doc.paymentDate ?? "", paymentMode: doc.paymentMode ?? "", reference: doc.reference ?? "",
    signatoryName: doc.signatoryName ?? "", note: doc.note ?? "", footerText: doc.footerText ?? "",
    showDraftMark: doc.showDraftMark ?? false, watermark: doc.watermark ?? ""
  };
}

/** Only what the API accepts — none of the stored totals, timestamps or authorship. */
function toInput(form: CustomPayslipDoc) {
  return {
    status: form.status, employee: form.employee || null, employeeName: form.employeeName,
    title: form.title, periodLabel: form.periodLabel, month: form.month || "",
    company: form.company,
    details: form.details.filter(line => line.label || line.value),
    attendance: form.attendance,
    earnings: form.earnings.filter(row => row.name.trim()),
    deductions: form.deductions.filter(row => row.name.trim()),
    employerContributions: form.employerContributions.filter(row => row.name.trim()),
    employerContributionsNote: form.employerContributionsNote,
    netPayMode: form.netPayMode, netPayOverride: form.netPayOverride, roundOff: form.roundOff,
    showAmountInWords: form.showAmountInWords,
    paymentDate: form.paymentDate || "", paymentMode: form.paymentMode || "", reference: form.reference ?? "",
    signatoryName: form.signatoryName, note: form.note, footerText: form.footerText,
    showDraftMark: form.showDraftMark, watermark: form.watermark
  };
}
