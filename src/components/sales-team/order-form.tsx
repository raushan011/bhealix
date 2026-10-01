"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button, Card, Field, Notice, Spinner } from "@/components/ui/kit";
import {
  collectAmountOf, describeRule, formatRupees, incentiveAmountOf, PAYMENT_MODE_LABEL, paymentProblem, priceOrder,
  ruleFor, TEAM_PAYMENT_MODES, type IncentiveRule, type TeamPaymentMode
} from "@/lib/sales-team/orders";
import { call, INDIAN_STATES, messageOf, type TeamOrderRow } from "./shared";

type Product = { id: string; name: string; price: number; mrp?: number; sku?: string; stock?: number };
type Catalogue = { source: "Shopify" | "Catalogue"; items: Product[]; refusal?: string };
type Executive = { _id: string; name: string; employeeId?: string };
type Line = { key: number; product?: string; variantId?: string; sku?: string; title: string; quantity: number; price: number };
type Known = { customer: Record<string, string> | null; lastOrder: { name: string; placedAt: string } | null; orders: number };

const blankCustomer = { name: "", phone: "", email: "", address1: "", address2: "", city: "", state: "", pinCode: "" };

/**
 * Placing — or, before it goes to the courier, correcting — a sales order.
 *
 * Totals, what the courier will collect and the incentive are worked out as the
 * form is filled in, by the same functions the server uses to store them
 * (§4.1), so what the executive sees on the right is exactly what is saved.
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
  const [products, setProducts] = useState<Product[]>([]);
  const [source, setSource] = useState<Catalogue["source"]>("Catalogue");
  const [refusal, setRefusal] = useState("");
  const [known, setKnown] = useState<Known | null>(null);
  const [executives, setExecutives] = useState<Executive[]>([]);
  const [rules, setRules] = useState<IncentiveRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [executive, setExecutive] = useState("");
  const [customer, setCustomer] = useState(blankCustomer);
  const [lines, setLines] = useState<Line[]>([{ key: 1, title: "", quantity: 1, price: 0 }]);
  const [discount, setDiscount] = useState(0);
  const [mode, setMode] = useState<TeamPaymentMode>("COD");
  const [advance, setAdvance] = useState(0);
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [leadName, setLeadName] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [catalogue, settings, team, lead] = await Promise.all([
          call<Catalogue>("/api/sales-team/products"),
          call<{ incentiveRules: IncentiveRule[] }>("/api/sales-team/settings"),
          admin && !existing ? call<{ items: Executive[] }>("/api/sales-team/executives") : Promise.resolve({ items: [] }),
          leadId && !existing ? call<{ lead: { name: string; phone?: string; address?: string; city?: string; assignedTo?: { _id: string } | null } }>(`/api/sales-team/leads/${leadId}`) : Promise.resolve(null)
        ]);
        setProducts(catalogue.items);
        setSource(catalogue.source);
        setRefusal(catalogue.refusal ?? "");
        setRules(settings.incentiveRules);
        setExecutives(team.items);
        if (lead) {
          setLeadName(lead.lead.name);
          setCustomer(current => ({ ...current, name: lead.lead.name, phone: lead.lead.phone ?? "", address1: lead.lead.address ?? "", city: lead.lead.city ?? "" }));
          if (lead.lead.assignedTo?._id) setExecutive(lead.lead.assignedTo._id);
        }
        if (existing) {
          setCustomer({ ...blankCustomer, ...Object.fromEntries(Object.entries(existing.customer).map(([key, value]) => [key, value ?? ""])) });
          setLines(existing.items.map((item, index) => ({ key: index + 1, product: item.product, variantId: item.variantId, sku: item.sku, title: item.title, quantity: item.quantity, price: item.price ?? 0 })));
          setDiscount(existing.totals.discount);
          setMode(existing.paymentMode);
          setAdvance(existing.paymentMode === "Partial" ? existing.advancePaid ?? 0 : 0);
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

  const priced = useMemo(() => priceOrder(lines, discount), [lines, discount]);
  const effectiveAdvance = mode === "Prepaid" ? priced.total : mode === "COD" ? 0 : advance;
  const collect = collectAmountOf(mode, priced.total, effectiveAdvance);
  const problem = paymentProblem(mode, priced.total, effectiveAdvance);
  const rule = ruleFor(rules, mode);
  const incentive = incentiveAmountOf(rule, priced.total);

  const setLine = (key: number, patch: Partial<Line>) =>
    setLines(current => current.map(line => line.key === key ? { ...line, ...patch } : line));

  /** A line points at a Shopify variant or a catalogue product, depending on where orders go. */
  const pickedId = (line: Line) => (source === "Shopify" ? line.variantId : line.product) ?? "";

  function pickProduct(key: number, id: string) {
    const product = products.find(item => item.id === id);
    if (!product) { setLine(key, { product: undefined, variantId: undefined, sku: undefined }); return; }
    setLine(key, {
      ...(source === "Shopify" ? { variantId: product.id, product: undefined } : { product: product.id, variantId: undefined }),
      sku: product.sku, title: product.name, price: product.price || product.mrp || 0
    });
  }

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
    if (problem) { setError(problem); return; }

    const order = {
      customer,
      items: lines.filter(line => line.title.trim()).map(line => ({
        product: line.product, variantId: line.variantId, sku: line.sku || undefined,
        title: line.title.trim(), quantity: Number(line.quantity), price: Number(line.price)
      })),
      discount: Number(discount) || 0,
      paymentMode: mode,
      advancePaid: Number(effectiveAdvance) || 0,
      paymentReference: reference,
      notes
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

  if (loading) return <Spinner label="Loading the catalogue…" />;

  return <form onSubmit={submit} className="grid gap-5 lg:grid-cols-[1fr_320px] lg:items-start">
    <div className="space-y-5">
      {refusal && !existing && <Notice tone="error">{refusal}</Notice>}
      {source === "Shopify" && !refusal && !existing && <Notice>This order is placed in your Shopify store, tagged with the executive&rsquo;s name, and its stock comes off Shopify.</Notice>}
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

      <Card className="space-y-4 p-5">
        <h2 className="text-[15px] font-semibold">Customer</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name"><input className="input" required value={customer.name} onChange={event => setCustomer({ ...customer, name: event.target.value })} /></Field>
          <Field label="Phone" hint="10-digit mobile — the courier rings it."><input className="input" required inputMode="tel" value={customer.phone} onChange={event => setCustomer({ ...customer, phone: event.target.value })} onBlur={event => lookUp(event.target.value)} /></Field>
          <Field label="Email"><input className="input" type="email" value={customer.email} onChange={event => setCustomer({ ...customer, email: event.target.value })} placeholder="Optional" /></Field>
          <Field label="Pin code"><input className="input" required inputMode="numeric" maxLength={6} value={customer.pinCode} onChange={event => setCustomer({ ...customer, pinCode: event.target.value.replace(/\D/g, "") })} /></Field>
        </div>
        {known?.customer && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-[var(--info-line)] bg-[var(--info-bg)] px-3 py-2 text-sm text-[var(--info-ink)]">
            <span>Ordered before — {known.orders} order{known.orders === 1 ? "" : "s"}{known.lastOrder ? `, last ${known.lastOrder.name}` : ""}. Delivered to {[known.customer.address1, known.customer.city, known.customer.pinCode].filter(Boolean).join(", ")}.</span>
            <Button type="button" tone="secondary" className="!min-h-[34px] text-xs" onClick={useKnownAddress}>Use this address</Button>
          </div>
        )}
        <Field label="Address"><input className="input" required value={customer.address1} onChange={event => setCustomer({ ...customer, address1: event.target.value })} placeholder="House, street, area" /></Field>
        <Field label="Landmark"><input className="input" value={customer.address2} onChange={event => setCustomer({ ...customer, address2: event.target.value })} placeholder="Optional" /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="City"><input className="input" required value={customer.city} onChange={event => setCustomer({ ...customer, city: event.target.value })} /></Field>
          <Field label="State">
            <input className="input" required list="team-states" value={customer.state} onChange={event => setCustomer({ ...customer, state: event.target.value })} />
            <datalist id="team-states">{INDIAN_STATES.map(state => <option key={state} value={state} />)}</datalist>
          </Field>
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">Products</h2>
          <Button type="button" tone="ghost" className="!min-h-[36px] text-xs"
            onClick={() => setLines(current => [...current, { key: Math.max(0, ...current.map(line => line.key)) + 1, title: "", quantity: 1, price: 0 }])}>
            <Plus size={14} />Add line
          </Button>
        </div>
        {lines.map(line => (
          <div key={line.key} className="grid gap-3 rounded-[10px] border border-[var(--line)] p-3 sm:grid-cols-[1fr_90px_120px_auto] sm:items-end">
            <Field label="Product">
              <select className="select" value={pickedId(line)} onChange={event => pickProduct(line.key, event.target.value)}>
                <option value="">{source === "Shopify" ? "Choose a product…" : "Type a product below…"}</option>
                {products.map(product => (
                  <option key={product.id} value={product.id} disabled={product.stock !== undefined && product.stock <= 0}>
                    {product.name}{product.price ? ` — ${formatRupees(product.price)}` : ""}
                    {product.stock !== undefined ? (product.stock > 0 ? ` (${product.stock} in stock)` : " (out of stock)") : ""}
                  </option>
                ))}
              </select>
              {!pickedId(line) && <input className="input mt-2" placeholder={source === "Shopify" ? "Or type a product Shopify does not list" : "Product name"} value={line.title} onChange={event => setLine(line.key, { title: event.target.value })} />}
            </Field>
            <Field label="Qty"><input className="input" type="number" min={1} max={999} value={line.quantity} onChange={event => setLine(line.key, { quantity: Math.max(1, Number(event.target.value) || 1) })} /></Field>
            <Field label="Price each (₹)"><input className="input" type="number" min={0} step="0.01" value={line.price} onChange={event => setLine(line.key, { price: Math.max(0, Number(event.target.value) || 0) })} /></Field>
            <button type="button" aria-label="Remove line" disabled={lines.length === 1}
              onClick={() => setLines(current => current.filter(item => item.key !== line.key))}
              className="tap grid place-items-center rounded-[10px] text-[var(--danger-ink)] hover:bg-[var(--danger-bg)] disabled:opacity-30">
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        <Field label="Discount on the order (₹)" hint="Taken off the order before anything else, and shared across the lines.">
          <input className="input sm:max-w-[200px]" type="number" min={0} step="0.01" value={discount} onChange={event => setDiscount(Math.max(0, Number(event.target.value) || 0))} />
        </Field>
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="text-[15px] font-semibold">Payment</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          {TEAM_PAYMENT_MODES.map(value => {
            const option = ruleFor(rules, value);
            return <label key={value} className={`cursor-pointer rounded-[12px] border p-3 transition-colors ${mode === value ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-[var(--line-2)] hover:bg-[var(--surface-2)]"}`}>
              <input type="radio" name="mode" value={value} checked={mode === value} onChange={() => setMode(value)} className="sr-only" />
              <span className="block text-sm font-semibold">{PAYMENT_MODE_LABEL[value]}</span>
              <span className="mt-0.5 block text-xs text-[var(--muted)]">Incentive: {describeRule(option)}</span>
            </label>;
          })}
        </div>
        {mode === "Partial" && (
          <Field label="Advance received (₹)" hint="What the customer has already paid. The courier collects the rest.">
            <input className="input sm:max-w-[200px]" type="number" min={0} step="0.01" value={advance} onChange={event => setAdvance(Math.max(0, Number(event.target.value) || 0))} />
          </Field>
        )}
        {mode !== "COD" && (
          <Field label="Payment reference" hint="The UPI or bank transaction id for what was paid up front.">
            <input className="input" value={reference} onChange={event => setReference(event.target.value)} />
          </Field>
        )}
        <Field label="Notes"><textarea className="textarea" rows={2} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Anything the person packing or delivering should know" /></Field>
      </Card>
    </div>

    <Card className="space-y-3 p-5 lg:sticky lg:top-6">
      <h2 className="text-[15px] font-semibold">Summary</h2>
      <Row label="Products" value={formatRupees(priced.gross)} />
      {priced.discount > 0 && <Row label="Discount" value={`− ${formatRupees(priced.discount)}`} />}
      <Row label="Order total" value={formatRupees(priced.total)} strong />
      <div className="border-t border-[var(--line)] pt-3" />
      {mode !== "COD" && <Row label="Paid up front" value={formatRupees(effectiveAdvance)} />}
      <Row label="Courier collects" value={formatRupees(collect)} strong />
      <div className="rounded-[10px] bg-[var(--surface-2)] p-3 text-sm">
        <p className="text-xs text-[var(--muted)]">Incentive once delivered</p>
        <p className="mt-0.5 text-lg font-semibold">{rule.enabled ? formatRupees(incentive) : "None"}</p>
        <p className="text-xs text-[var(--muted)]">{describeRule(rule)}</p>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <Button type="submit" busy={busy} className="w-full" disabled={(Boolean(problem) && priced.total > 0) || (Boolean(refusal) && !existing)}>
        {existing ? "Save changes" : "Place order"}
      </Button>
      {problem && priced.total > 0 && <p className="text-xs text-[var(--warn-ink)]">{problem}</p>}
      <p className="text-xs text-[var(--muted)]">{source === "Shopify" ? "The order goes into Shopify straight away. Booking the courier is the next step, from the order." : "Placing the order does not book the courier yet — you do that from the order, once you have checked it."}</p>
    </Card>
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
