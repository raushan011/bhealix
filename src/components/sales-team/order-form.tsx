"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Gift, Minus, Plus } from "lucide-react";
import { Button, Card, Field, Notice, Spinner } from "@/components/ui/kit";
import {
  collectAmountOf, describeRule, formatRupees, incentiveAmountOf, PAYMENT_MODE_LABEL, paymentProblem,
  ruleFor, TEAM_PAYMENT_MODES, type IncentiveRule, type TeamPaymentMode
} from "@/lib/sales-team/orders";
import { DEFAULT_RULES, FREE_BAG_ID, quote, type CatalogueItem, type PricingRules } from "@/lib/sales-team/pricing";
import { call, INDIAN_STATES, messageOf, type TeamOrderRow } from "./shared";
import { usePincodeLookup } from "@/components/ui/use-pincode";

type Executive = { _id: string; name: string; employeeId?: string };
type Known = { customer: Record<string, string> | null; lastOrder: { name: string; placedAt: string } | null; orders: number };

const blankCustomer = { name: "", phone: "", email: "", address1: "", address2: "", city: "", state: "", pinCode: "" };

/**
 * Placing — or, before it goes to the courier, correcting — a sales order.
 *
 * Products come from the Sales Team Handbook's catalogue and are priced by its
 * rules (`lib/sales-team/pricing.ts`): the executive chooses what and how many,
 * the payment mode, and whether to release the extra discount where it is
 * allowed. They never type a price. The same function prices the order on the
 * server before it is saved (§4.1, §4.2), so the figure read out to the customer
 * is the figure stored.
 *
 * `admin` adds the one field an executive never sees: whose sale this is.
 */
export function OrderForm({ admin, basePath, leadId, existing }: {
  admin: boolean;
  basePath: string;
  leadId?: string;
  existing?: TeamOrderRow;
}) {
  const router = useRouter();
  const [catalogue, setCatalogue] = useState<CatalogueItem[]>([]);
  const [pricing, setPricing] = useState<PricingRules>(DEFAULT_RULES);
  const [refusal, setRefusal] = useState("");
  const [known, setKnown] = useState<Known | null>(null);
  const [executives, setExecutives] = useState<Executive[]>([]);
  const [rules, setRules] = useState<IncentiveRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [executive, setExecutive] = useState("");
  const [customer, setCustomer] = useState(blankCustomer);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [extra, setExtra] = useState(false);
  const [freeBag, setFreeBag] = useState(false);
  const [mode, setMode] = useState<TeamPaymentMode>("COD");
  const [advance, setAdvance] = useState(DEFAULT_RULES.partialAdvance);
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [leadName, setLeadName] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [products, settings, team, lead] = await Promise.all([
          call<{ catalogue: CatalogueItem[]; pricing: PricingRules }>("/api/sales-team/products"),
          call<{ incentiveRules: IncentiveRule[]; shopifyRefusal: string | null }>("/api/sales-team/settings"),
          admin && !existing ? call<{ items: Executive[] }>("/api/sales-team/executives") : Promise.resolve({ items: [] }),
          leadId && !existing ? call<{ lead: { name: string; phone?: string; address?: string; city?: string; assignedTo?: { _id: string } | null } }>(`/api/sales-team/leads/${leadId}`) : Promise.resolve(null)
        ]);
        setCatalogue(products.catalogue);
        setPricing(products.pricing);
        setAdvance(products.pricing.partialAdvance);
        setRefusal(settings.shopifyRefusal ?? "");
        setRules(settings.incentiveRules);
        setExecutives(team.items);
        if (lead) {
          setLeadName(lead.lead.name);
          setCustomer(current => ({ ...current, name: lead.lead.name, phone: lead.lead.phone ?? "", address1: lead.lead.address ?? "", city: lead.lead.city ?? "" }));
          if (lead.lead.assignedTo?._id) setExecutive(lead.lead.assignedTo._id);
        }
        if (existing) {
          setCustomer({ ...blankCustomer, ...Object.fromEntries(Object.entries(existing.customer).map(([key, value]) => [key, value ?? ""])) });
          const picked: Record<string, number> = {};
          for (const item of existing.items) {
            if (item.catalogueId && item.catalogueId !== FREE_BAG_ID) picked[item.catalogueId] = (picked[item.catalogueId] ?? 0) + item.quantity;
          }
          setQuantities(picked);
          setFreeBag(existing.items.some(item => item.catalogueId === FREE_BAG_ID));
          setExtra(Boolean(existing.pricing?.extra));
          setMode(existing.paymentMode);
          if (existing.paymentMode === "Partial") setAdvance(existing.advancePaid ?? products.pricing.partialAdvance);
          setReference(existing.paymentReference ?? "");
          setNotes(existing.notes ?? "");
        }
      } catch (problem) {
        setError(messageOf(problem));
      } finally {
        setLoading(false);
      }
    })();
  }, [admin, leadId, existing]);

  const items = useMemo(() => Object.entries(quantities).filter(([, quantity]) => quantity > 0).map(([catalogueId, quantity]) => ({ catalogueId, quantity })), [quantities]);
  const priced = useMemo(() => quote({ catalogue, rules: pricing, items, paymentMode: mode, extra, freeBag }), [catalogue, pricing, items, mode, extra, freeBag]);
  // What the same basket costs in each mode, for the executive to read out.
  const byMode = useMemo(() => Object.fromEntries(TEAM_PAYMENT_MODES.map(value =>
    [value, quote({ catalogue, rules: pricing, items, paymentMode: value, extra: value === "COD" ? false : extra, freeBag }).total])) as Record<TeamPaymentMode, number>,
  [catalogue, pricing, items, extra, freeBag]);

  const effectiveAdvance = mode === "Prepaid" ? priced.total : mode === "COD" ? 0 : advance;
  const collect = collectAmountOf(mode, priced.total, effectiveAdvance);
  const problem = paymentProblem(mode, priced.total, effectiveAdvance);
  const rule = ruleFor(rules, mode);
  const incentive = incentiveAmountOf(rule, priced.total);
  const hasExistingWithoutCatalogue = Boolean(existing?.items.some(item => !item.catalogueId));

  // A COD order cannot carry the extra discount; switching to COD takes it back.
  useEffect(() => { if (mode === "COD" && extra) setExtra(false); }, [mode, extra]);

  /*
   * The live check: can a courier deliver here, and how likely is this parcel
   * to come back. Asked a moment after the pin code, phone, payment or total
   * settle — not on every keystroke — while the customer is still on the line.
   */
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const pinReady = /^\d{6}$/.test(customer.pinCode);
  // City and state from the pin code, as Shiprocket's own form does.
  const pinLookup = usePincodeLookup(customer.pinCode, place =>
    setCustomer(current => current.pinCode === place.pinCode ? { ...current, city: place.city, state: place.state } : current));
  useEffect(() => {
    if (!pinReady) { setCheck(null); return; }
    const timer = setTimeout(async () => {
      setChecking(true);
      try {
        setCheck(await call<CheckResult>("/api/sales-team/check", {
          body: {
            pinCode: customer.pinCode, phone: customer.phone, paymentMode: mode, total: priced.total, advance: effectiveAdvance,
            address1: customer.address1, address2: customer.address2, city: customer.city
          }
        }));
      } catch {
        setCheck(null);
      } finally {
        setChecking(false);
      }
    }, 900);
    return () => clearTimeout(timer);
  }, [pinReady, customer.pinCode, customer.phone, customer.address1, customer.address2, customer.city, mode, priced.total, effectiveAdvance]);

  const setQuantity = (id: string, quantity: number) =>
    setQuantities(current => ({ ...current, [id]: Math.max(0, Math.min(99, quantity)) }));

  /**
   * A repeat customer, recognised by phone. Their last delivered-to address is
   * offered rather than filled in over whatever is already typed.
   */
  async function lookUp(phone: string) {
    const digits = phone.replace(/\D/g, "").slice(-10);
    if (digits.length !== 10 || existing) { setKnown(null); return; }
    try {
      const found = await call<Known>(`/api/sales-team/customers?phone=${digits}`);
      setKnown(found.customer ? found : null);
    } catch {
      setKnown(null);
    }
  }

  function useKnownAddress() {
    if (!known?.customer) return;
    const saved = known.customer;
    setCustomer(current => ({
      ...current,
      name: current.name || saved.name || "",
      email: current.email || saved.email || "",
      address1: saved.address1 ?? "", address2: saved.address2 ?? "",
      city: saved.city ?? "", state: saved.state ?? "", pinCode: saved.pinCode ?? ""
    }));
    setKnown(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (admin && !existing && !executive) { setError("Choose the sales executive this order belongs to."); return; }
    if (!items.length) { setError("Add at least one product."); return; }
    if (problem) { setError(problem); return; }

    const order = {
      customer, items, extraDiscount: extra && priced.extraAllowed, freeBag,
      paymentMode: mode, advancePaid: Number(effectiveAdvance) || 0, paymentReference: reference, notes
    };

    setBusy(true);
    try {
      if (existing) {
        await call(`/api/sales-team/orders/${existing._id}`, { method: "PATCH", body: { action: "edit", order } });
        router.push(`${basePath}/${existing._id}`);
      } else {
        const created = await call<{ _id: string }>("/api/sales-team/orders", {
          body: { ...order, executive: admin ? executive : undefined, lead: leadId }
        });
        router.push(`${basePath}/${created._id}?placed=1`);
      }
      router.refresh();
    } catch (failure) {
      setError(messageOf(failure));
      setBusy(false);
    }
  }

  if (loading) return <Spinner label="Loading the price list…" />;

  const sellable = catalogue.filter(item => item.kind !== "Gift");
  const bag = catalogue.find(item => item.id === FREE_BAG_ID);
  const blocked = (Boolean(problem) && priced.total > 0) || (Boolean(refusal) && !existing) || !items.length;

  return <form onSubmit={submit} className="grid gap-5 pb-20 lg:grid-cols-[1fr_340px] lg:items-start lg:pb-0">
    <div className="space-y-5">
      {refusal && !existing && <Notice tone="error">{refusal}</Notice>}
      {hasExistingWithoutCatalogue && <Notice tone="warning">This order was placed before the handbook price list. Choose its products again below.</Notice>}
      {leadName && <Notice>Converting the lead <strong>{leadName}</strong>. Placing this order marks the lead Converted.</Notice>}

      {admin && !existing && (
        <Card className="p-5">
          <Field label="Sales executive" hint="The order, and its incentive, belong to them.">
            <select className="select" value={executive} onChange={event => setExecutive(event.target.value)} required>
              <option value="">Choose…</option>
              {executives.map(person => <option key={person._id} value={person._id}>{person.name}{person.employeeId ? ` · ${person.employeeId}` : ""}</option>)}
            </select>
          </Field>
          {!executives.length && <p className="mt-2 text-xs text-[var(--warn-ink)]">No sales executives yet. Add one under HR &amp; Employees with the Sales executive role.</p>}
        </Card>
      )}

      <Card className="space-y-3 p-4 sm:p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[15px] font-semibold">Products</h2>
          <span className="text-xs text-[var(--muted)]">MRP · handbook price list</span>
        </div>
        <div className="divide-y divide-[var(--line)] rounded-[12px] border border-[var(--line)]">
          {sellable.map(item => {
            const quantity = quantities[item.id] ?? 0;
            return <div key={item.id} className={`flex items-center gap-3 px-3 py-3 ${quantity ? "bg-[var(--brand-soft)]" : ""}`}>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{item.name}</p>
                <p className="text-xs text-[var(--muted)]">
                  MRP {formatRupees(item.mrp)}
                  {item.kind === "Kit" && item.offerPrice ? ` · offer ${formatRupees(item.offerPrice)}` : ""}
                  {item.kind === "Testing kit" ? " · flat price" : ""}
                </p>
                {item.note && <p className="mt-0.5 hidden text-[11px] text-[var(--muted)] sm:block">{item.note}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button type="button" aria-label={`One less ${item.name}`} disabled={!quantity} onClick={() => setQuantity(item.id, quantity - 1)}
                  className="tap grid place-items-center rounded-full border border-[var(--line-2)] disabled:opacity-30"><Minus size={15} /></button>
                <span className="w-7 text-center text-sm font-semibold tabular-nums">{quantity}</span>
                <button type="button" aria-label={`One more ${item.name}`} onClick={() => setQuantity(item.id, quantity + 1)}
                  className="tap grid place-items-center rounded-full bg-[var(--brand)] text-[var(--on-brand)]"><Plus size={15} /></button>
              </div>
            </div>;
          })}
        </div>

        {items.length > 0 && <p className="text-xs text-[var(--muted)]">
          {priced.label}: {formatRupees(priced.mrpTotal)} MRP → {formatRupees(priced.offerTotal)} offer.
          {" "}Quote the MRP first, then the offer.
        </p>}

        {bag?.active && (
          <label className={`flex cursor-pointer items-center gap-3 rounded-[12px] border px-3 py-3 ${freeBag ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-[var(--line-2)]"}`}>
            <input type="checkbox" checked={freeBag} onChange={event => setFreeBag(event.target.checked)} />
            <Gift size={17} className="text-[var(--brand)]" />
            <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">Add a free bag</span>
              <span className="block text-xs text-[var(--muted)]">{bag.note || "Free of charge."}</span></span>
          </label>
        )}

        {items.length > 0 && (
          <label className={`flex items-start gap-3 rounded-[12px] border px-3 py-3 ${!priced.extraAllowed ? "opacity-60" : extra ? "border-[var(--warn-line)] bg-[var(--warn-bg)]" : "border-[var(--line-2)]"}`}>
            <input type="checkbox" className="mt-1" disabled={!priced.extraAllowed} checked={extra && priced.extraAllowed} onChange={event => setExtra(event.target.checked)} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">Release the extra {pricing.extraPct}%{extra && priced.extraOff ? ` (−${formatRupees(priced.extraOff)})` : ""}</span>
              <span className="block text-xs text-[var(--muted)]">
                {priced.extraAllowed ? "Only if the customer is about to walk away. Present it as a one-time approval." : priced.extraReason}
              </span>
            </span>
          </label>
        )}
        {priced.warnings.map(warning => <Notice key={warning} tone="warning">{warning}</Notice>)}
      </Card>

      <Card className="space-y-4 p-4 sm:p-5">
        <h2 className="text-[15px] font-semibold">Payment</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          {TEAM_PAYMENT_MODES.map(value => {
            const option = ruleFor(rules, value);
            return <label key={value} className={`cursor-pointer rounded-[12px] border p-3 transition-colors ${mode === value ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-[var(--line-2)] hover:bg-[var(--surface-2)]"}`}>
              <input type="radio" name="mode" value={value} checked={mode === value} onChange={() => setMode(value)} className="sr-only" />
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold">{PAYMENT_MODE_LABEL[value]}</span>
                {items.length > 0 && <span className="text-sm font-semibold tabular-nums">{formatRupees(byMode[value])}</span>}
              </span>
              <span className="mt-0.5 block text-xs text-[var(--muted)]">
                {value === "Prepaid" ? `₹${pricing.prepaidOff} off · ` : value === "Partial" ? `₹${pricing.partialAdvance} now · ` : ""}You earn {describeRule(option).replace(" of the order", "")}
              </span>
            </label>;
          })}
        </div>
        <p className="text-xs text-[var(--muted)]">Push Prepaid first, then Partial, and only then COD.</p>
        {mode === "Partial" && (
          <Field label="Advance received (₹)" hint={`The handbook's booking advance is ₹${pricing.partialAdvance}. The courier collects the rest.`}>
            <input className="input sm:max-w-[200px]" type="number" min={0} step="1" value={advance} onChange={event => setAdvance(Math.max(0, Number(event.target.value) || 0))} />
          </Field>
        )}
        {mode !== "COD" && (
          <Field label="Payment reference" hint="The UPI or bank transaction id for what was paid up front.">
            <input className="input" value={reference} onChange={event => setReference(event.target.value)} />
          </Field>
        )}
      </Card>

      <Card className="space-y-4 p-4 sm:p-5">
        <h2 className="text-[15px] font-semibold">Customer</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name"><input className="input" required value={customer.name} onChange={event => setCustomer({ ...customer, name: event.target.value })} /></Field>
          <Field label="Phone" hint="10-digit mobile — the courier rings it."><input className="input" required inputMode="tel" value={customer.phone} onChange={event => setCustomer({ ...customer, phone: event.target.value })} onBlur={event => lookUp(event.target.value)} /></Field>
          <Field label="Email"><input className="input" type="email" value={customer.email} onChange={event => setCustomer({ ...customer, email: event.target.value })} placeholder="Optional" /></Field>
          <Field label="Pin code" hint={pinLookup.looking ? "Finding the city and state…" : pinLookup.missing ? "City and state not found — type them below." : "City and state fill in by themselves."}><input className="input" required inputMode="numeric" maxLength={6} value={customer.pinCode} onChange={event => setCustomer({ ...customer, pinCode: event.target.value.replace(/\D/g, "") })} /></Field>
        </div>
        {known?.customer && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-[var(--info-line)] bg-[var(--info-bg)] px-3 py-2 text-sm text-[var(--info-ink)]">
            <span>Ordered before — {known.orders} order{known.orders === 1 ? "" : "s"}{known.lastOrder ? `, last ${known.lastOrder.name}` : ""}. Delivered to {[known.customer.address1, known.customer.city, known.customer.pinCode].filter(Boolean).join(", ")}.</span>
            <Button type="button" tone="secondary" className="!min-h-[34px] text-xs" onClick={useKnownAddress}>Use this address</Button>
          </div>
        )}
        <Field label="Address"><input className="input" required value={customer.address1} onChange={event => setCustomer({ ...customer, address1: event.target.value })} placeholder="House / flat no., street, area" /></Field>
        <Field label="Landmark"><input className="input" value={customer.address2} onChange={event => setCustomer({ ...customer, address2: event.target.value })} placeholder="Optional" /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="City"><input className="input" required value={customer.city} onChange={event => setCustomer({ ...customer, city: event.target.value })} /></Field>
          <Field label="State">
            <input className="input" required list="team-states" value={customer.state} onChange={event => setCustomer({ ...customer, state: event.target.value })} />
            <datalist id="team-states">{INDIAN_STATES.map(state => <option key={state} value={state} />)}</datalist>
          </Field>
        </div>
        <Field label="Notes"><textarea className="textarea" rows={2} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Anything the person packing or delivering should know" /></Field>
      </Card>

      <DeliveryCheckCard check={check} checking={checking} pinReady={pinReady} mode={mode} onPrepaid={() => setMode("Prepaid")} />
    </div>

    <Card className="space-y-3 p-5 lg:sticky lg:top-6">
      <h2 className="text-[15px] font-semibold">Summary</h2>
      <Row label="MRP" value={formatRupees(priced.mrpTotal)} />
      {priced.mrpTotal > priced.offerTotal && <Row label={`${priced.label} offer`} value={`− ${formatRupees(priced.mrpTotal - priced.offerTotal)}`} />}
      {priced.prepaidOff > 0 && <Row label="Prepaid" value={`− ${formatRupees(priced.prepaidOff)}`} />}
      {priced.extraOff > 0 && <Row label={`Extra ${pricing.extraPct}%`} value={`− ${formatRupees(priced.extraOff)}`} />}
      {freeBag && <Row label="Free bag" value="₹0" />}
      <Row label="Customer pays" value={formatRupees(priced.total)} strong />
      <div className="border-t border-[var(--line)] pt-3" />
      {mode !== "COD" && <Row label="Paid up front" value={formatRupees(effectiveAdvance)} />}
      <Row label="Courier collects" value={formatRupees(collect)} strong />
      <div className="rounded-[10px] bg-[var(--surface-2)] p-3 text-sm">
        <p className="text-xs text-[var(--muted)]">You earn once delivered</p>
        <p className="mt-0.5 text-lg font-semibold">{rule.enabled ? formatRupees(incentive) : "None"}</p>
        <p className="text-xs text-[var(--muted)]">{describeRule(rule)}</p>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <Button type="submit" busy={busy} className="w-full" disabled={blocked}>
        {existing ? "Save changes" : "Place order"}
      </Button>
      {problem && priced.total > 0 && <p className="text-xs text-[var(--warn-ink)]">{problem}</p>}
      <p className="text-xs text-[var(--muted)]">The order is recorded straight away. Booking the courier is the next step, from the order.</p>
    </Card>

    {/*
     * On a phone the summary sits at the very bottom of a long form, so the
     * total and the button travel with the thumb instead — just above the
     * executive panel's tab bar.
     */}
    <div className={`fixed inset-x-0 z-20 border-t border-[var(--line)] bg-[var(--surface)] px-3 py-2.5 lg:hidden ${admin ? "bottom-0 pb-[max(0.625rem,env(safe-area-inset-bottom))]" : "bottom-[calc(60px+env(safe-area-inset-bottom))]"}`}>
      <div className="mx-auto flex max-w-[520px] items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold tabular-nums">{formatRupees(priced.total)}{priced.mrpTotal > priced.total ? <span className="ml-1.5 text-xs font-normal text-[var(--muted)] line-through">{formatRupees(priced.mrpTotal)}</span> : null}</p>
          <p className="truncate text-[11px] text-[var(--muted)]">
            Collect {formatRupees(collect)}{rule.enabled && incentive ? ` · earn ${formatRupees(incentive)}` : ""}
            {check?.risk ? ` · ${check.risk.level} risk` : ""}
          </p>
        </div>
        <Button type="submit" busy={busy} className="shrink-0 !px-5" disabled={blocked}>
          {existing ? "Save" : "Place order"}
        </Button>
      </div>
    </div>
  </form>;
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return <div className="flex items-center justify-between gap-3 text-sm">
    <span className="text-[var(--muted)]">{label}</span>
    <span className={`tabular-nums ${strong ? "font-semibold" : ""}`}>{value}</span>
  </div>;
}

/** The same form, opened on an order that has not gone to the courier yet. */
export function OrderEditor({ id, admin, basePath }: { id: string; admin: boolean; basePath: string }) {
  const [order, setOrder] = useState<TeamOrderRow | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    call<{ order: TeamOrderRow; may: { edit: boolean } }>(`/api/sales-team/orders/${id}`)
      .then(result => result.may.edit ? setOrder(result.order) : setError("This order can no longer be edited — it has been cancelled or is already with the courier."))
      .catch(problem => setError(messageOf(problem)));
  }, [id]);
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!order) return <Spinner label="Loading the order…" />;
  return <OrderForm admin={admin} basePath={basePath} existing={order} />;
}

type CheckResult = {
  delivery: { deliverable: boolean; cod: boolean; couriers: number; fastestDays?: number; cheapestRate?: number; etd?: string; refusal?: string } | null;
  risk: { score: number; level: "Low" | "Medium" | "High"; reasons: string[]; advice?: string };
  history: { phone: { delivered: number; returned: number } | null; pin: { delivered: number; returned: number } | null };
};

/**
 * What the courier network and the company's own delivery record say about
 * this order, shown while it can still be changed: a COD order to a pin code
 * no courier collects cash in is switched to prepaid now, not refused at the
 * counter tomorrow.
 */
function DeliveryCheckCard({ check, checking, pinReady, mode, onPrepaid }: {
  check: CheckResult | null; checking: boolean; pinReady: boolean; mode: TeamPaymentMode; onPrepaid: () => void;
}) {
  if (!pinReady) return <Card className="p-4 text-sm text-[var(--muted)]">Enter the 6-digit pin code to check delivery and the RTO risk.</Card>;
  if (!check) return <Card className="p-4 text-sm text-[var(--muted)]">{checking ? "Checking delivery to this pin code…" : "Could not check this pin code right now."}</Card>;

  const delivery = check.delivery;
  const risk = check.risk;
  const tone = risk.level === "High" ? "border-[var(--danger-line)] bg-[var(--danger-bg)]" : risk.level === "Medium" ? "border-[var(--warn-line)] bg-[var(--warn-bg)]" : "border-[var(--ok-line)] bg-[var(--ok-bg)]";
  const ink = risk.level === "High" ? "text-[var(--danger-ink)]" : risk.level === "Medium" ? "text-[var(--warn-ink)]" : "text-[var(--ok-ink)]";

  return <Card className="space-y-3 p-4">
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-[15px] font-semibold">Delivery check</h2>
      {checking && <span className="text-xs text-[var(--muted)]">Updating…</span>}
    </div>
    {delivery?.refusal ? <p className="text-sm text-[var(--muted)]">{delivery.refusal}</p> : delivery && (
      delivery.deliverable
        ? <p className="text-sm"><span className="font-semibold text-[var(--ok-ink)]">Deliverable</span> — {delivery.couriers} courier{delivery.couriers === 1 ? "" : "s"}
            {delivery.fastestDays ? `, fastest in ${delivery.fastestDays} day${delivery.fastestDays === 1 ? "" : "s"}` : ""}
            {delivery.cheapestRate ? `, from ${formatRupees(delivery.cheapestRate)}` : ""}.
            {" "}{delivery.cod ? "Cash on delivery available." : <span className="font-semibold text-[var(--danger-ink)]">No cash on delivery here.</span>}</p>
        : <p className="text-sm font-semibold text-[var(--danger-ink)]">No courier delivers to this pin code. Check the pin code with the customer.</p>
    )}
    {delivery && !delivery.refusal && delivery.deliverable && !delivery.cod && mode !== "Prepaid" && (
      <Button type="button" tone="secondary" className="w-full !min-h-[38px] text-xs" onClick={onPrepaid}>Switch to prepaid</Button>
    )}
    <div className={`rounded-[10px] border p-3 ${tone}`}>
      <p className={`text-sm font-semibold ${ink}`}>RTO risk: {risk.level} <span className="font-normal">({risk.score}/100)</span></p>
      <ul className={`mt-1 list-disc space-y-0.5 pl-4 text-xs ${ink}`}>
        {risk.reasons.slice(0, 5).map(reason => <li key={reason}>{reason}</li>)}
      </ul>
      {risk.advice && <p className={`mt-1.5 text-xs font-semibold ${ink}`}>{risk.advice}</p>}
    </div>
  </Card>;
}
