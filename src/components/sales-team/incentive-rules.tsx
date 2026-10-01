"use client";

import { useEffect, useState } from "react";
import { Button, Card, Notice, Spinner } from "@/components/ui/kit";
import {
  describeRule, formatRupees, incentiveAmountOf, INCENTIVE_TYPES, PAYMENT_MODE_LABEL, type IncentiveRule, type IncentiveType, type TeamOrderChannel
} from "@/lib/sales-team/orders";
import { call, messageOf } from "./shared";

const EXAMPLE_ORDER = 1499;

const WHY: Record<IncentiveRule["mode"], string> = {
  Prepaid: "The customer paid in full before dispatch. These never come back unpaid.",
  Partial: "The customer paid an advance; the courier collects the rest. Refused far less often than COD.",
  COD: "The customer pays the courier at the door. The most likely to be refused and returned."
};

/**
 * What a COD, prepaid and part-paid order earns the executive who placed it.
 *
 * One row per payment mode, each with its own switch, so an administrator can
 * decide — for instance — that COD earns nothing until the return rate comes
 * down, without touching the other two. Each order carries the rule it was
 * placed under; re-pricing the unpaid ones is a choice made out loud.
 */
export function IncentiveRules() {
  const [rules, setRules] = useState<IncentiveRule[] | null>(null);
  const [mayEdit, setMayEdit] = useState(false);
  const [channel, setChannel] = useState<TeamOrderChannel>("Shopify");
  const [shopifyRefusal, setShopifyRefusal] = useState<string | null>(null);
  const [applyToUnpaid, setApplyToUnpaid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    call<{ incentiveRules: IncentiveRule[]; mayEdit: boolean; orderChannel: TeamOrderChannel; shopifyRefusal: string | null }>("/api/sales-team/settings")
      .then(result => { setRules(result.incentiveRules); setMayEdit(result.mayEdit); setChannel(result.orderChannel); setShopifyRefusal(result.shopifyRefusal); })
      .catch(problem => setNotice({ tone: "error", text: messageOf(problem) }));
  }, []);

  const update = (mode: IncentiveRule["mode"], patch: Partial<IncentiveRule>) =>
    setRules(current => current?.map(rule => rule.mode === mode ? { ...rule, ...patch } : rule) ?? null);

  async function save() {
    if (!rules) return;
    setBusy(true); setNotice(null);
    try {
      const result = await call<{ message: string; incentiveRules: IncentiveRule[] }>("/api/sales-team/settings", { method: "PUT", body: { incentiveRules: rules, applyToUnpaid, orderChannel: channel } });
      setRules(result.incentiveRules);
      setApplyToUnpaid(false);
      const fresh = await call<{ shopifyRefusal: string | null }>("/api/sales-team/settings");
      setShopifyRefusal(fresh.shopifyRefusal);
      setNotice({ tone: "success", text: result.message });
    } catch (problem) { setNotice({ tone: "error", text: messageOf(problem) }); } finally { setBusy(false); }
  }

  if (!rules) return notice ? <Notice tone="error">{notice.text}</Notice> : <Spinner label="Loading the rules…" />;

  return <div className="space-y-4">
    <Card className="space-y-3 p-5">
      <h2 className="text-[15px] font-semibold">Where orders are placed</h2>
      <div className="grid gap-2 sm:grid-cols-2">
        {([
          ["Shopify", "In your Shopify store", "Every order is created in Shopify, tagged with the executive (filter by the tag exec-<employee ID>), takes stock off Shopify and reaches Shiprocket like any shop order."],
          ["Direct", "Straight to the courier", "The order lives only in this CRM and is booked with Shiprocket from here. For when the store is not connected."]
        ] as const).map(([value, title, text]) => (
          <label key={value} className={`cursor-pointer rounded-[12px] border p-3 ${channel === value ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-[var(--line-2)]"} ${mayEdit ? "" : "cursor-default"}`}>
            <input type="radio" className="sr-only" checked={channel === value} disabled={!mayEdit} onChange={() => setChannel(value)} />
            <span className="block text-sm font-semibold">{title}</span>
            <span className="mt-0.5 block text-xs text-[var(--muted)]">{text}</span>
          </label>
        ))}
      </div>
      {channel === "Shopify" && shopifyRefusal && <Notice tone="warning">{shopifyRefusal}</Notice>}
    </Card>

    {rules.map(rule => (
      <Card key={rule.mode} className="grid gap-4 p-5 sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <label className="relative inline-flex cursor-pointer items-center">
              <input type="checkbox" className="peer sr-only" checked={rule.enabled} disabled={!mayEdit} onChange={event => update(rule.mode, { enabled: event.target.checked })} />
              <span className="h-6 w-11 rounded-full bg-[var(--line-2)] transition-colors peer-checked:bg-[var(--brand)]" />
              <span className="absolute left-0.5 top-0.5 size-5 rounded-full bg-[var(--surface)] transition-transform peer-checked:translate-x-5" />
            </label>
            <h2 className="text-[15px] font-semibold">{PAYMENT_MODE_LABEL[rule.mode]}</h2>
          </div>
          <p className="mt-1 text-sm text-[var(--muted)]">{WHY[rule.mode]}</p>
          <p className="mt-1 text-xs text-[var(--ink-2)]">
            {rule.enabled ? `${describeRule(rule)} — a ${formatRupees(EXAMPLE_ORDER)} order earns ${formatRupees(incentiveAmountOf(rule, EXAMPLE_ORDER))} once delivered.` : "Orders paid this way earn no incentive."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select className="select !w-auto" value={rule.type} disabled={!mayEdit || !rule.enabled} onChange={event => update(rule.mode, { type: event.target.value as IncentiveType })} aria-label={`${rule.mode} type`}>
            {INCENTIVE_TYPES.map(type => <option key={type} value={type}>{type === "Percentage" ? "% of order" : "₹ per order"}</option>)}
          </select>
          <input className="input !w-28" type="number" min={0} max={rule.type === "Percentage" ? 100 : 100000} step={rule.type === "Percentage" ? 0.5 : 10}
            value={rule.value} disabled={!mayEdit || !rule.enabled} onChange={event => update(rule.mode, { value: Math.max(0, Number(event.target.value) || 0) })} aria-label={`${rule.mode} value`} />
        </div>
      </Card>
    ))}

    {mayEdit && <Card className="space-y-3 p-5">
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={applyToUnpaid} onChange={event => setApplyToUnpaid(event.target.checked)} />
        <span>Also re-price every order not yet paid at these rules.<span className="block text-xs text-[var(--muted)]">Leave it off and the new rules apply to orders placed from now on — each existing order keeps the rule it was sold under. Paid incentives are never changed either way.</span></span>
      </label>
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      <Button busy={busy} onClick={save}>Save settings</Button>
    </Card>}
    {!mayEdit && notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
  </div>;
}
