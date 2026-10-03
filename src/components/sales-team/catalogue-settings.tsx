"use client";

import { useEffect, useState } from "react";
import { Plus, RotateCcw } from "lucide-react";
import { Button, Card, Field, Notice, Spinner } from "@/components/ui/kit";
import type { IncentiveRule } from "@/lib/sales-team/orders";
import { formatRupees } from "@/lib/sales-team/orders";
import {
  CATALOGUE_KINDS, DEFAULT_CATALOGUE, DEFAULT_RULES, quote, type CatalogueItem, type CatalogueKind, type PricingRules
} from "@/lib/sales-team/pricing";
import { call, messageOf } from "./shared";

type Settings = { catalogue: CatalogueItem[]; pricing: PricingRules; incentiveRules: IncentiveRule[]; mayEdit: boolean };

/**
 * The sales team's price list and discount rules — the Sales Team Handbook,
 * editable.
 *
 * Executives never type a price: they pick from this list, and the rules below
 * work out the offer. A price change here reaches every new quote at once and
 * never restates an order already placed. A worked example under the rules
 * shows what they produce, so a change can be checked against the handbook's
 * own sheets before it is saved.
 */
export function CatalogueSettings() {
  const [data, setData] = useState<Settings | null>(null);
  const [catalogue, setCatalogue] = useState<CatalogueItem[]>([]);
  const [pricing, setPricing] = useState<PricingRules>(DEFAULT_RULES);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    call<Settings>("/api/sales-team/settings").then(result => {
      setData(result); setCatalogue(result.catalogue); setPricing(result.pricing);
    }).catch(problem => setNotice({ tone: "error", text: messageOf(problem) }));
  }, []);

  const update = (index: number, patch: Partial<CatalogueItem>) =>
    setCatalogue(current => current.map((item, at) => at === index ? { ...item, ...patch } : item));

  async function save() {
    if (!data) return;
    setBusy(true); setNotice(null);
    try {
      await call("/api/sales-team/settings", {
        method: "PUT",
        body: {
          pricing,
          catalogue: catalogue.map(item => ({
            ...item,
            offerPrice: item.kind === "Kit" ? item.offerPrice : undefined,
            floor: item.kind === "Kit" ? item.floor : undefined,
            sku: item.sku || undefined, note: item.note || undefined
          }))
        }
      });
      setNotice({ tone: "success", text: "Price list saved. New quotes use it straight away; orders already placed keep their prices." });
    } catch (problem) { setNotice({ tone: "error", text: messageOf(problem) }); } finally { setBusy(false); }
  }

  if (!data) return notice ? <Notice tone="error">{notice.text}</Notice> : <Spinner label="Loading the price list…" />;
  const editable = data.mayEdit;

  // Worked examples, straight from the rules as they stand on screen.
  const example = (ids: string[], mode: "COD" | "Prepaid" | "Partial", extra = false) =>
    quote({ catalogue, rules: pricing, items: ids.map(catalogueId => ({ catalogueId, quantity: 1 })), paymentMode: mode, extra }).total;
  const firstProducts = catalogue.filter(item => item.kind === "Product" && item.active).slice(0, 2).map(item => item.id);
  const kit = catalogue.find(item => item.kind === "Kit" && item.active);

  return <div className="space-y-4">
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-semibold">Products & prices</h2>
          <p className="text-xs text-[var(--muted)]">The handbook&rsquo;s MRP list. Executives choose from these and never type a price.</p>
        </div>
        {editable && <Button type="button" tone="ghost" className="!min-h-[36px] text-xs" onClick={() => setCatalogue(DEFAULT_CATALOGUE.map(item => ({ ...item })))}><RotateCcw size={14} />Reset to handbook</Button>}
      </div>
      <div className="space-y-3">
        {catalogue.map((item, index) => (
          <div key={index} className={`grid gap-3 rounded-[12px] border border-[var(--line)] p-3 sm:grid-cols-[1.6fr_1fr_0.8fr_0.8fr_0.8fr_auto] sm:items-end ${item.active ? "" : "opacity-60"}`}>
            <Field label="Name"><input className="input" value={item.name} disabled={!editable} onChange={event => update(index, { name: event.target.value })} /></Field>
            <Field label="Type">
              <select className="select" value={item.kind} disabled={!editable} onChange={event => update(index, { kind: event.target.value as CatalogueKind })}>
                {CATALOGUE_KINDS.map(kind => <option key={kind}>{kind}</option>)}
              </select>
            </Field>
            <Field label="MRP (₹)"><input className="input" type="number" min={0} value={item.mrp} disabled={!editable} onChange={event => update(index, { mrp: Math.max(0, Number(event.target.value) || 0) })} /></Field>
            <Field label="Offer (₹)"><input className="input" type="number" min={0} value={item.kind === "Kit" ? item.offerPrice ?? "" : ""} disabled={!editable || item.kind !== "Kit"} placeholder={item.kind === "Kit" ? "" : "rules"} onChange={event => update(index, { offerPrice: Math.max(0, Number(event.target.value) || 0) })} /></Field>
            <Field label="Floor (₹)"><input className="input" type="number" min={0} value={item.kind === "Kit" ? item.floor ?? "" : ""} disabled={!editable || item.kind !== "Kit"} placeholder={item.kind === "Kit" ? "" : "—"} onChange={event => update(index, { floor: Math.max(0, Number(event.target.value) || 0) })} /></Field>
            <label className="flex items-center gap-2 pb-3 text-sm"><input type="checkbox" checked={item.active} disabled={!editable} onChange={event => update(index, { active: event.target.checked })} />On sale</label>
            <div className="sm:col-span-6">
              <input className="input text-xs" value={item.note ?? ""} disabled={!editable} placeholder="One line for the executive on the call (optional)" onChange={event => update(index, { note: event.target.value })} />
            </div>
          </div>
        ))}
      </div>
      {editable && <Button type="button" tone="secondary" onClick={() => setCatalogue(current => [...current, { id: `item-${current.length + 1}`, name: "", kind: "Product", mrp: 0, active: true }])}><Plus size={15} />Add a product</Button>}
    </Card>

    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-[15px] font-semibold">Discount rules</h2>
        <p className="text-xs text-[var(--muted)]">From the handbook, Section 6. Percentages are taken on MRP and rounded to the rupee.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-5">
        {([
          ["singlePct", "Single product % off"],
          ["comboPct", "Combo (2+) % off"],
          ["prepaidOff", "Prepaid ₹ off"],
          ["extraPct", "Extra % (combo & Kit)"],
          ["partialAdvance", "Partial advance ₹"]
        ] as const).map(([key, label]) => (
          <Field key={key} label={label}>
            <input className="input" type="number" min={0} value={pricing[key]} disabled={!editable} onChange={event => setPricing({ ...pricing, [key]: Math.max(0, Number(event.target.value) || 0) })} />
          </Field>
        ))}
      </div>
      <div className="rounded-[10px] bg-[var(--surface-2)] p-3 text-xs text-[var(--ink-2)]">
        <p className="mb-1 font-semibold">What these rules produce</p>
        {firstProducts[0] && <p>One {catalogue.find(item => item.id === firstProducts[0])?.name}: COD {formatRupees(example([firstProducts[0]], "COD"))} · Prepaid {formatRupees(example([firstProducts[0]], "Prepaid"))}</p>}
        {firstProducts.length === 2 && <p>Combo of two: COD {formatRupees(example(firstProducts, "COD"))} · Prepaid {formatRupees(example(firstProducts, "Prepaid"))} · floor {formatRupees(example(firstProducts, "Prepaid", true))}</p>}
        {kit && <p>{kit.name}: COD {formatRupees(example([kit.id], "COD"))} · Prepaid {formatRupees(example([kit.id], "Prepaid"))} · with extra {formatRupees(example([kit.id], "Prepaid", true))} (never below {formatRupees(kit.floor ?? 0)})</p>}
      </div>
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {editable && <Button busy={busy} onClick={save}>Save price list</Button>}
    </Card>
  </div>;
}
