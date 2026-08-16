"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, X } from "lucide-react";
import { Button, Card, Field, Notice, PageTitle, Spinner } from "@/components/ui/kit";
import {
  ESI_WAGE_CEILING, LOP_BASES, PAY_MODES, PF_WAGE_CEILING,
  type LopBasis, type PayMode, type PtSlab
} from "@/lib/hr/payroll";

type Settings = {
  lopBasis: LopBasis; pfEnabled: boolean;
  ptSlabs: PtSlab[]; ptStateName?: string; ptFebruaryAmount?: number | null;
  payDay: number; defaultPayMode?: PayMode; signatoryName?: string; payslipNote?: string;
};

/**
 * How this company runs its payroll.
 *
 * The professional tax slabs live here as data rather than in the code because
 * they are state law, differ everywhere, and are changed by state budgets on
 * their own timetable — a slab change should be a Saturday at the HR desk, not
 * a release. The statutory rates that are national and rarely move are shown
 * but not editable.
 */
export default function PayrollSettingsPage() {
  const [form, setForm] = useState<Settings | null>(null);
  const [mayEdit, setMayEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/hr/payroll/settings").then(response => response.json())
      .then((json: { data?: { settings: Settings; mayEdit: boolean } }) => {
        setForm(json.data?.settings ?? null);
        setMayEdit(Boolean(json.data?.mayEdit));
      });
  }, []);

  if (!form) return <Spinner label="Loading the payroll settings…" />;
  const set = (patch: Partial<Settings>) => setForm(current => current ? { ...current, ...patch } : current);

  const setSlab = (index: number, patch: Partial<PtSlab>) =>
    set({ ptSlabs: form.ptSlabs.map((slab, i) => i === index ? { ...slab, ...patch } : slab) });

  async function save() {
    if (!form) return;
    setBusy(true); setNotice(null);
    const response = await fetch("/api/hr/payroll/settings", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...form, ptFebruaryAmount: form.ptFebruaryAmount ?? null })
    });
    const json = await response.json() as { error?: string };
    setBusy(false);
    setNotice(response.ok
      ? { tone: "success", text: "Payroll settings saved." }
      : { tone: "error", text: json.error ?? "Could not save these settings" });
  }

  return <div className="space-y-5">
    <Link href="/admin/hr/payroll" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--brand)]">
      <ArrowLeft size={16} />Payroll
    </Link>

    <PageTitle title="Payroll settings" subtitle="How a day is counted, and what the state charges"
      actions={mayEdit ? <Button busy={busy} onClick={save}>Save</Button> : undefined} />

    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
    {!mayEdit && <Notice tone="info">You can read these settings but not change them.</Notice>}

    <Card className="space-y-4 p-5">
      <h2 className="text-sm font-semibold">A day&apos;s pay</h2>
      <Field label="A month is divided by"
        hint="Calendar days pays the same in February as in March. Working days leaves week offs and company holidays out of both the divisor and the count. It cannot be changed while a draft month is open.">
        <select value={form.lopBasis} className="select" disabled={!mayEdit}
          onChange={event => set({ lopBasis: event.target.value as LopBasis })}>
          {LOP_BASES.map(basis => <option key={basis}>{basis}</option>)}
        </select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Pay day" hint="The day of the month salaries are ordinarily paid.">
          <input type="number" min={1} max={31} value={form.payDay} className="input" disabled={!mayEdit}
            onChange={event => set({ payDay: Math.min(31, Math.max(1, Number(event.target.value) || 1)) })} />
        </Field>
        <Field label="Ordinarily paid by">
          <select value={form.defaultPayMode ?? "Bank transfer"} className="select" disabled={!mayEdit}
            onChange={event => set({ defaultPayMode: event.target.value as PayMode })}>
            {PAY_MODES.map(mode => <option key={mode}>{mode}</option>)}
          </select>
        </Field>
      </div>
    </Card>

    {/* A company either runs a fund or it does not, and that is the answer for
        everybody at once. Left to the individual salary records it would be
        turned off one person at a time and back on by the next new joiner. */}
    <Card className="space-y-3 p-5">
      <h2 className="text-sm font-semibold">Provident fund</h2>
      <label className="flex items-start gap-2.5 text-sm">
        <input type="checkbox" checked={form.pfEnabled} disabled={!mayEdit}
          className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]"
          onChange={event => set({ pfEnabled: event.target.checked })} />
        <span className="min-w-0">This company operates a provident fund</span>
      </label>
      <p className="text-xs text-[var(--muted)]">
        {form.pfEnabled
          ? "Deducted from everybody whose salary record puts them in the fund, and the employer's share is shown as a "
            + "cost to the company."
          : "No payslip carries a fund deduction or an employer share, whatever an individual salary record says. Turn "
            + "this on the month the company starts contributing. A month already prepared keeps the figures it was "
            + "worked out from until it is prepared again, and says so on its own page."}
      </p>
    </Card>

    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-sm font-semibold">Professional tax</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">
          A state tax, so the slabs are yours to set. The monthly gross is read against them; the last slab is the
          open-ended one and applies to everything above the slab before it.
        </p>
      </div>

      <Field label="State">
        <input value={form.ptStateName ?? ""} className="input" disabled={!mayEdit} placeholder="Karnataka"
          onChange={event => set({ ptStateName: event.target.value })} />
      </Field>

      <div className="space-y-2">
        {form.ptSlabs.map((slab, index) => {
          const open = slab.upTo === null;
          return <div key={index} className="flex items-center gap-2">
            <span className="w-24 shrink-0 text-xs text-[var(--muted)]">{open ? "Above that" : "Gross up to"}</span>
            <input type="number" min={0} value={open ? "" : slab.upTo ?? 0} disabled={!mayEdit || open}
              placeholder={open ? "No ceiling" : ""} className="input flex-1"
              onChange={event => setSlab(index, { upTo: Number(event.target.value) || 0 })} />
            <span className="shrink-0 text-xs text-[var(--muted)]">charge</span>
            <input type="number" min={0} value={slab.amount} className="input w-28 shrink-0" disabled={!mayEdit}
              onChange={event => setSlab(index, { amount: Number(event.target.value) || 0 })} />
            {mayEdit && form.ptSlabs.length > 1 && (
              <button type="button" aria-label="Remove this slab" className="tap grid shrink-0 place-items-center rounded-[10px] text-[var(--danger-ink)]"
                onClick={() => set({ ptSlabs: form.ptSlabs.filter((_, i) => i !== index) })}><X size={16} /></button>
            )}
          </div>;
        })}
        {mayEdit && (
          <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand)]"
            onClick={() => set({ ptSlabs: [...form.ptSlabs.filter(slab => slab.upTo !== null), { upTo: 0, amount: 0 }, ...form.ptSlabs.filter(slab => slab.upTo === null)] })}>
            <Plus size={13} />Add a slab
          </button>
        )}
      </div>

      <Field label="February charge (optional)"
        hint="For a state that meets its annual ceiling with a larger charge in the last month of the financial year. Leave empty where every month is alike.">
        <input type="number" min={0} className="input" disabled={!mayEdit}
          value={form.ptFebruaryAmount ?? ""}
          onChange={event => set({ ptFebruaryAmount: event.target.value === "" ? null : Number(event.target.value) })} />
      </Field>
    </Card>

    <Card className="space-y-4 p-5">
      <h2 className="text-sm font-semibold">On the payslip</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Signed by" hint="Left empty, the payslip carries no signature block.">
          <input value={form.signatoryName ?? ""} className="input" disabled={!mayEdit}
            onChange={event => set({ signatoryName: event.target.value })} />
        </Field>
        <Field label="Footnote">
          <input value={form.payslipNote ?? ""} className="input" disabled={!mayEdit}
            placeholder="Queries to the HR desk within 7 days"
            onChange={event => set({ payslipNote: event.target.value })} />
        </Field>
      </div>
    </Card>

    {/* Stated rather than editable: these are national and set by statute. A
        company that could type its own PF rate would file a return that does
        not reconcile. */}
    <Card className="p-5">
      <h2 className="text-sm font-semibold">Statutory rates</h2>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <Row label="Provident fund" value={`12% of basic, on wages up to ₹${PF_WAGE_CEILING.toLocaleString("en-IN")}`} />
        <Row label="Employer's fund share" value="12%, of which 8.33% goes to the pension scheme" />
        <Row label="State insurance" value={`0.75% employee and 3.25% employer, up to a gross of ₹${ESI_WAGE_CEILING.toLocaleString("en-IN")}`} />
        <Row label="Gratuity provision" value="4.81% of basic, a company cost and never a deduction" />
      </dl>
      <p className="mt-3 text-xs text-[var(--muted)]">
        The fund only applies at all while the company operates one, set above. Beyond that, whether an individual is
        covered and whether it is worked out on the whole basic or only up to the ceiling is set on their own salary
        record.
      </p>
    </Card>
  </div>;
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex items-start justify-between gap-3">
    <dt className="shrink-0 text-[var(--muted)]">{label}</dt>
    <dd className="min-w-0 text-right font-medium">{value}</dd>
  </div>;
}
