"use client";

import { useEffect, useState } from "react";
import { Package, RotateCcw } from "lucide-react";
import { Button, Card, Field, Notice, Spinner } from "@/components/ui/kit";
import {
  DEFAULT_PACKAGING, VOLUMETRIC_DIVISOR, WEIGHT_BASES, WEIGHT_BASIS_LABEL,
  deadWeightKg, declaredWeightKg, volumetricWeightKg, type PackagingRules, type WeightBasis
} from "@/lib/sales-team/packaging";
import { CATALOGUE_KINDS } from "@/lib/sales-team/pricing";
import { call, messageOf } from "./shared";

type Settings = { packaging: PackagingRules; mayEdit: boolean };

/**
 * The one carton every sales-team parcel goes out in, and what goes into it.
 *
 * Set once here, and every executive's booking is sent to Shiprocket at these
 * figures — nobody types a weight per order. The table underneath shows exactly
 * what Shiprocket will be told for one, two, three and more products, so the
 * administrator can check it against the scale before saving.
 */
export function PackagingSettings() {
  const [data, setData] = useState<Settings | null>(null);
  const [rules, setRules] = useState<PackagingRules>(DEFAULT_PACKAGING);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    call<Settings>("/api/sales-team/settings").then(result => {
      setData(result); setRules(result.packaging);
    }).catch(problem => setNotice({ tone: "error", text: messageOf(problem) }));
  }, []);

  async function save() {
    setBusy(true); setNotice(null);
    try {
      const result = await call<{ message: string }>("/api/sales-team/settings", { method: "PUT", body: { packaging: rules } });
      setNotice({ tone: "success", text: result.message });
    } catch (problem) { setNotice({ tone: "error", text: messageOf(problem) }); } finally { setBusy(false); }
  }

  if (!data) return notice ? <Notice tone="error">{notice.text}</Notice> : <Spinner label="Loading the package settings…" />;
  const editable = data.mayEdit;
  const set = (patch: Partial<PackagingRules>) => setRules(current => ({ ...current, ...patch }));
  const amount = (value: string) => Math.max(0, Number(value) || 0);
  const volumetric = volumetricWeightKg(rules);

  return <Card className="space-y-4 p-5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 className="flex items-center gap-2 text-[15px] font-semibold"><Package size={16} />Package & weight for Shiprocket</h2>
        <p className="text-xs text-[var(--muted)]">
          Every sales order is booked at this box size and weight automatically, so the courier&rsquo;s re-weigh never comes back higher.
        </p>
      </div>
      {editable && <Button type="button" tone="ghost" className="!min-h-[36px] text-xs" onClick={() => setRules(DEFAULT_PACKAGING)}><RotateCcw size={14} />Reset</Button>}
    </div>

    <div className="grid gap-3 sm:grid-cols-5">
      <Field label="One product (g)"><input className="input" type="number" min={1} value={rules.unitGrams} disabled={!editable} onChange={event => set({ unitGrams: amount(event.target.value) })} /></Field>
      <Field label="Packaging (g)"><input className="input" type="number" min={0} value={rules.packagingGrams} disabled={!editable} onChange={event => set({ packagingGrams: amount(event.target.value) })} /></Field>
      <Field label="Length (cm)"><input className="input" type="number" min={1} value={rules.length} disabled={!editable} onChange={event => set({ length: amount(event.target.value) })} /></Field>
      <Field label="Breadth (cm)"><input className="input" type="number" min={1} value={rules.breadth} disabled={!editable} onChange={event => set({ breadth: amount(event.target.value) })} /></Field>
      <Field label="Height (cm)"><input className="input" type="number" min={1} value={rules.height} disabled={!editable} onChange={event => set({ height: amount(event.target.value) })} /></Field>
    </div>

    <Field label="Weight sent to Shiprocket">
      <select className="select" value={rules.basis} disabled={!editable} onChange={event => set({ basis: event.target.value as WeightBasis })}>
        {WEIGHT_BASES.map(basis => <option key={basis} value={basis}>{WEIGHT_BASIS_LABEL[basis]}</option>)}
      </select>
    </Field>

    <div>
      <p className="mb-2 text-xs font-semibold text-[var(--ink-2)]">Products counted for each catalogue item</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {CATALOGUE_KINDS.map(kind => (
          <Field key={kind} label={kind}>
            <input className="input" type="number" min={0} step="1" value={rules.unitsPerKind[kind]} disabled={!editable}
              onChange={event => set({ unitsPerKind: { ...rules.unitsPerKind, [kind]: amount(event.target.value) } })} />
          </Field>
        ))}
      </div>
    </div>

    <div className="rounded-[10px] bg-[var(--surface-2)] p-3 text-xs text-[var(--ink-2)]">
      <p className="mb-1 font-semibold">
        Volumetric weight: {rules.length} × {rules.breadth} × {rules.height} ÷ {VOLUMETRIC_DIVISOR} = {volumetric} kg
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[320px] tabular-nums">
          <thead><tr className="text-left text-[var(--muted)]"><th className="py-1 font-medium">Products</th><th className="font-medium">Dead weight</th><th className="font-medium">Volumetric</th><th className="font-medium">Sent to Shiprocket</th></tr></thead>
          <tbody>
            {[1, 2, 3, 4, 6].map(units => (
              <tr key={units}>
                <td className="py-0.5">{units}</td>
                <td>{deadWeightKg(units, rules)} kg</td>
                <td>{volumetric} kg</td>
                <td className="font-semibold">{declaredWeightKg(units, rules)} kg</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[var(--muted)]">Weights are rounded up to the next 10 g, never down.</p>
    </div>

    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
    {editable && <Button type="button" busy={busy} onClick={save}>Save package</Button>}
  </Card>;
}
