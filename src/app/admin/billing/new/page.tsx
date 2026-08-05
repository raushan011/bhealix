"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, Plus, Trash2, X } from "lucide-react";
import { Badge, Button, Card, Field, Notice, PageTitle, Spinner } from "@/components/ui/kit";
import { DoctorPicker, type PickableDoctor } from "@/components/doctors/doctor-picker";
import { CustomerPicker } from "@/components/billing/customer-picker";
import { CustomerForm } from "@/components/billing/customer-form";
import { todayIso } from "@/lib/time";
import { computeInvoice, type LineInput } from "@/lib/billing/gst";
import { dueDateFrom } from "@/lib/billing/numbering";
import { customerTitle, type CustomerRecord } from "@/lib/billing/customers";
import {
  CUSTOMER_TYPES, formatMoney, GST_RATES, PAYMENT_MODES, stateCodeOfGstin, stateName, STATES,
  type DiscountType, type PartySource, type PaymentMode
} from "@/lib/billing/constants";

type Product = {
  _id: string; name: string; hsnCode?: string; unit?: string;
  price?: number; mrp?: number; gstRate?: number; active: boolean;
};
type Person = { _id: string; name: string; employeeId: string };
type Settings = {
  legalName: string; gstin?: string; state?: string; stateCode?: string;
  defaultPaymentTerms: number; defaultGstRate: number; ratesIncludeTax: boolean; terms?: string;
};
type Line = LineInput & { product?: string };

const blankLine = (): Line => ({
  name: "", hsnCode: "", unit: "Pcs", quantity: 1, rate: 0,
  discountType: "PERCENT", discountValue: 0, gstRate: 0
});

export default function NewBillPage() {
  const router = useRouter();

  const [products, setProducts] = useState<Product[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [stock, setStock] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);

  const [partySource, setPartySource] = useState<PartySource>("Doctor");
  const [doctor, setDoctor] = useState<PickableDoctor | null>(null);
  const [customer, setCustomer] = useState<CustomerRecord | null>(null);
  const [addingCustomer, setAddingCustomer] = useState(false);
  // A one-off buyer is typed here and nowhere else — no directory record.
  const [oneOff, setOneOff] = useState({ name: "", type: "Individual", phone: "", address: "", city: "", pinCode: "" });
  const [employee, setEmployee] = useState("");
  const [taxed, setTaxed] = useState(true);
  const [ratesIncludeTax, setRatesIncludeTax] = useState(false);
  const [gstin, setGstin] = useState("");
  const [placeOfSupply, setPlaceOfSupply] = useState("");

  const [invoiceDate, setInvoiceDate] = useState(todayIso);
  const [paymentTerms, setPaymentTerms] = useState(0);
  const [dueDate, setDueDate] = useState(todayIso);
  const [followUpDate, setFollowUpDate] = useState("");

  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");

  const [collectNow, setCollectNow] = useState(false);
  const [paidAmount, setPaidAmount] = useState(0);
  const [paidMode, setPaidMode] = useState<PaymentMode>("Cash");
  const [paidReference, setPaidReference] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/products").then(r => r.json()) as Promise<{ data?: { items: Product[] } }>,
      fetch("/api/team?field=1").then(r => r.json()) as Promise<{ data?: { items: Person[] } }>,
      fetch("/api/billing/settings").then(r => r.json()) as Promise<{ data?: { settings: Settings } }>,
      fetch("/api/inventory/stock").then(r => r.json()) as Promise<{ data?: { rows: Array<{ product: string; balance: number }> } }>
    ]).then(([catalogue, staff, config, levels]) => {
      setProducts(catalogue.data?.items ?? []);
      setPeople(staff.data?.items ?? []);
      setStock(new Map((levels.data?.rows ?? []).map(row => [row.product, row.balance])));

      const loaded = config.data?.settings;
      if (loaded) {
        setSettings(loaded);
        setRatesIncludeTax(loaded.ratesIncludeTax);
        setPaymentTerms(loaded.defaultPaymentTerms ?? 0);
        setDueDate(dueDateFrom(todayIso(), loaded.defaultPaymentTerms ?? 0));
        setPlaceOfSupply(loaded.stateCode ?? "");
        setTerms(loaded.terms ?? "");
        // Without a GSTIN there is nothing to charge tax under, so the bill
        // starts as a bill of supply rather than as an invoice that cannot save.
        if (!loaded.gstin) setTaxed(false);
      }
      setLoading(false);
    });
  }, []);

  // Choosing a buyer fills in whatever billing details their record already
  // holds; anything missing is typed once here and saved back for next time.
  useEffect(() => {
    if (!doctor) return;
    setGstin(doctor.gstin ?? "");
    if (doctor.stateCode) setPlaceOfSupply(doctor.stateCode);
  }, [doctor]);

  useEffect(() => {
    if (!customer) return;
    setGstin(customer.gstin ?? "");
    if (customer.stateCode) setPlaceOfSupply(customer.stateCode);
    // A stockist's own credit terms beat the house default.
    if (customer.creditPeriod) {
      setPaymentTerms(customer.creditPeriod);
      setDueDate(dueDateFrom(invoiceDate, customer.creditPeriod));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the invoice date is read, not tracked: changing it must not re-apply the buyer's terms.
  }, [customer]);

  /**
   * Switching who the bill is for clears whatever the last buyer contributed.
   * Without this, picking a doctor and then switching to a walk-in would leave
   * the doctor's GSTIN sitting on a bill made out to somebody else.
   */
  useEffect(() => {
    const chosen = partySource === "Doctor" ? doctor : partySource === "Customer" ? customer : null;
    setGstin(chosen?.gstin ?? "");
    setPlaceOfSupply(chosen?.stateCode || settings?.stateCode || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on the switch itself; the two buyer effects above cover a change of buyer within a mode.
  }, [partySource]);

  const setLine = (index: number, patch: Partial<Line>) =>
    setLines(current => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));

  /** Picking a product carries its HSN, unit, rate and GST slab onto the line. */
  function chooseProduct(index: number, name: string) {
    const product = products.find(item => item.name === name);
    setLine(index, {
      name,
      product: product?._id,
      hsnCode: product?.hsnCode ?? "",
      unit: product?.unit ?? "Pcs",
      rate: product?.price || 0,
      gstRate: taxed ? (product?.gstRate ?? settings?.defaultGstRate ?? 0) : 0
    });
  }

  const interState = Boolean(taxed && settings?.stateCode && placeOfSupply && placeOfSupply !== settings.stateCode);
  const filled = lines.filter(line => line.name && line.quantity > 0);

  /**
   * The same functions the server bills with, so the figures on screen are the
   * figures that get saved — not an approximation of them.
   *
   * Computed over every line rather than only the filled ones, so a priced line
   * can be found by its position; an empty line prices to zero and changes no
   * total.
   */
  const preview = useMemo(
    () => computeInvoice(lines, { taxed, interState, ratesIncludeTax }),
    [lines, taxed, interState, ratesIncludeTax]
  );

  /**
   * Warns before the bill is raised rather than leaving a negative balance to
   * be found later. Quantities are added up across lines first: the same
   * product on two lines draws on one shelf.
   */
  const shortages = useMemo(() => {
    const wanted = new Map<string, number>();
    for (const line of filled) wanted.set(line.name, (wanted.get(line.name) ?? 0) + line.quantity);
    return [...wanted]
      .map(([name, need]) => ({ name, need, have: stock.get(name) ?? 0 }))
      .filter(row => row.need > row.have);
  }, [filled, stock]);

  async function submit() {
    if (partySource === "Doctor" && !doctor) { setError("Choose the doctor this bill is for"); return; }
    if (partySource === "Customer" && !customer) { setError("Choose the customer this bill is for"); return; }
    if (partySource === "One-off" && oneOff.name.trim().length < 2) { setError("Enter the name this bill is for"); return; }
    if (!employee) { setError("Choose the representative this bill belongs to"); return; }
    if (!filled.length) { setError("Add at least one product"); return; }
    if (collectNow && paidAmount <= 0) { setError("Enter the amount received, or turn the receipt off"); return; }

    setBusy(true); setError("");
    try {
      const response = await fetch("/api/invoices", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          partySource,
          doctor: partySource === "Doctor" ? doctor?._id : undefined,
          customer: partySource === "Customer" ? customer?._id : undefined,
          employee,
          taxed,
          ratesIncludeTax,
          invoiceDate,
          dueDate: dueDate || undefined,
          paymentTerms,
          followUpDate: followUpDate || undefined,
          placeOfSupplyCode: placeOfSupply || undefined,
          // Only the overrides typed here; the rest comes off the buyer's record
          // on the server, which is the copy that cannot be tampered with.
          billTo: {
            gstin: gstin.trim().toUpperCase() || undefined,
            ...(partySource === "One-off" ? {
              name: oneOff.name.trim(),
              type: oneOff.type,
              address: oneOff.address.trim() || undefined,
              city: oneOff.city.trim() || undefined,
              pinCode: oneOff.pinCode.trim() || undefined,
              phone: oneOff.phone.trim() || undefined
            } : {})
          },
          items: filled.map(line => ({
            product: line.product,
            name: line.name,
            hsnCode: line.hsnCode || undefined,
            unit: line.unit || undefined,
            quantity: line.quantity,
            rate: line.rate,
            discountType: line.discountType,
            discountValue: line.discountValue,
            gstRate: taxed ? line.gstRate : 0
          })),
          notes: notes.trim() || undefined,
          terms: terms.trim() || undefined,
          payment: collectNow
            ? { amount: paidAmount, mode: paidMode, reference: paidReference.trim() || undefined, paidAt: invoiceDate }
            : undefined
        })
      });
      const json = await response.json() as { error?: string; data?: { _id: string } };
      if (!response.ok) throw new Error(json.error ?? "Could not raise this bill");
      router.push(`/admin/billing/${json.data?._id}`);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not raise this bill");
      setBusy(false);
    }
  }

  if (loading) return <Spinner label="Preparing the bill…" />;

  return <div className="space-y-5 pb-24">
    <Link href="/admin/billing" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--brand)]">
      <ArrowLeft size={16} />Billing
    </Link>
    <PageTitle title="New bill" subtitle="Products supplied to a doctor, a trade buyer or a one-off customer" />

    {!settings?.gstin && (
      <Notice tone="info">
        No GSTIN is saved yet, so this bill can only be raised as a bill of supply.{" "}
        <Link href="/admin/billing/settings" className="font-semibold underline underline-offset-2">Add your GST details</Link> to
        raise tax invoices.
      </Notice>
    )}

    <Card className="space-y-4 p-5">
      <h2 className="text-sm font-semibold">Who the bill is for</h2>

      {/* Three kinds of buyer, because supply does not stop at the doctor's door. */}
      <div className="grid gap-2 sm:grid-cols-3">
        <TypeChoice active={partySource === "Doctor"} onClick={() => setPartySource("Doctor")}
          title="Doctor" description="From your visiting directory" />
        <TypeChoice active={partySource === "Customer"} onClick={() => setPartySource("Customer")}
          title="Customer" description="Stockist, distributor, chemist, hospital" />
        <TypeChoice active={partySource === "One-off"} onClick={() => setPartySource("One-off")}
          title="One-off" description="A buyer you will not bill again" />
      </div>

      {partySource === "Doctor" && (
        <Field label="Doctor">
          {doctor ? (
            <ChosenParty title={doctor.name}
              subtitle={[doctor.clinicName, doctor.fullAddress || doctor.area, doctor.city].filter(Boolean).join(" · ") || "No address on record"}
              onClear={() => setDoctor(null)} />
          ) : (
            <DoctorPicker requireLocation={false} onSelect={setDoctor} placeholder="Search the doctor to bill" />
          )}
        </Field>
      )}

      {partySource === "Customer" && (
        <Field label="Customer">
          {customer ? (
            <ChosenParty title={customerTitle(customer)}
              subtitle={[customer.type, customer.address, customer.city, customer.gstin && `GSTIN ${customer.gstin}`]
                .filter(Boolean).join(" · ")}
              onClear={() => setCustomer(null)} />
          ) : <>
            <CustomerPicker onSelect={setCustomer} />
            <button type="button" onClick={() => setAddingCustomer(true)}
              className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand)]">
              <Plus size={13} />Add a new customer
            </button>
          </>}
        </Field>
      )}

      {partySource === "One-off" && (
        <div className="space-y-4 rounded-[10px] border border-[var(--line)] p-3">
          <p className="text-xs text-[var(--muted)]">
            Billed once and not filed. Use a customer record instead if you expect to supply them again.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name on the bill">
              <input value={oneOff.name} onChange={e => setOneOff({ ...oneOff, name: e.target.value })} className="input" />
            </Field>
            <Field label="Buyer type">
              <select value={oneOff.type} onChange={e => setOneOff({ ...oneOff, type: e.target.value })} className="select">
                {CUSTOMER_TYPES.map(value => <option key={value}>{value}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Address">
            <textarea value={oneOff.address} onChange={e => setOneOff({ ...oneOff, address: e.target.value })} className="textarea" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="City">
              <input value={oneOff.city} onChange={e => setOneOff({ ...oneOff, city: e.target.value })} className="input" />
            </Field>
            <Field label="PIN code">
              <input value={oneOff.pinCode} onChange={e => setOneOff({ ...oneOff, pinCode: e.target.value })} className="input" />
            </Field>
            <Field label="Phone">
              <input value={oneOff.phone} onChange={e => setOneOff({ ...oneOff, phone: e.target.value })} className="input" inputMode="tel" />
            </Field>
          </div>
        </div>
      )}

      <Field label="Representative" hint="Whose bill this is — they see it on their phone and chase the payment">
        <select value={employee} onChange={e => setEmployee(e.target.value)} className="select">
          <option value="">Choose a representative</option>
          {people.map(person => <option key={person._id} value={person._id}>{person.name} ({person.employeeId})</option>)}
        </select>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Buyer's GSTIN" hint="Leave blank for an unregistered buyer">
          <input value={gstin} className="input" placeholder="27AAPFU0939F1ZV" maxLength={15}
            onChange={e => {
              const value = e.target.value.toUpperCase();
              setGstin(value);
              // The first two digits of a GSTIN are the state, so the place of
              // supply fills itself in and cannot contradict the number above it.
              const code = stateCodeOfGstin(value);
              if (code) setPlaceOfSupply(code);
            }} />
        </Field>
        <Field label="Place of supply" hint={taxed
          ? interState ? "Outside your state — IGST will be charged" : "Within your state — CGST and SGST will be charged"
          : "Recorded on the bill for reference"}>
          <select value={placeOfSupply} onChange={e => setPlaceOfSupply(e.target.value)} className="select">
            <option value="">Not stated</option>
            {STATES.map(state => <option key={state.code} value={state.code}>{state.name} ({state.code})</option>)}
          </select>
        </Field>
      </div>
    </Card>

    <Card className="space-y-4 p-5">
      <h2 className="text-sm font-semibold">Type and dates</h2>

      <div className="grid gap-2 sm:grid-cols-2">
        <TypeChoice active={taxed} disabled={!settings?.gstin} onClick={() => {
          setTaxed(true);
          // Restore each line's slab from the catalogue when tax comes back on.
          setLines(current => current.map(line => ({
            ...line,
            gstRate: products.find(product => product.name === line.name)?.gstRate ?? settings?.defaultGstRate ?? 18
          })));
        }} title="Tax invoice" description="GST charged and shown line by line" />
        <TypeChoice active={!taxed} onClick={() => setTaxed(false)}
          title="Bill of supply" description="No GST on this bill" />
      </div>

      <label className="flex items-center gap-2.5 text-sm">
        <input type="checkbox" checked={ratesIncludeTax} onChange={e => setRatesIncludeTax(e.target.checked)} className="size-4" />
        <span>Rates below already include GST
          <span className="block text-xs text-[var(--muted)]">Tax is worked back out of the price rather than added on top</span>
        </span>
      </label>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Bill date">
          <input type="date" value={invoiceDate} className="input"
            onChange={e => { setInvoiceDate(e.target.value); setDueDate(dueDateFrom(e.target.value, paymentTerms)); }} />
        </Field>
        <Field label="Credit period" hint="Days">
          <input type="number" min={0} max={365} value={paymentTerms} className="input"
            onChange={e => {
              const days = Math.max(0, Number(e.target.value) || 0);
              setPaymentTerms(days);
              setDueDate(dueDateFrom(invoiceDate, days));
            }} />
        </Field>
        <Field label="Payment due">
          <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="input" />
        </Field>
        <Field label="Follow up on" hint="When the rep should call about it">
          <input type="date" value={followUpDate} onChange={e => setFollowUpDate(e.target.value)} className="input" />
        </Field>
      </div>
    </Card>

    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Products</h2>
        <button type="button" onClick={() => setLines(current => [...current, blankLine()])}
          className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand)]"><Plus size={13} />Add line</button>
      </div>

      {!products.length && (
        <Notice tone="error">
          The product catalogue is empty. <Link href="/admin/products" className="font-semibold underline underline-offset-2">Add your range</Link> before
          raising a bill.
        </Notice>
      )}

      <div className="space-y-3">
        {lines.map((line, index) => {
          const available = stock.get(line.name);
          const short = line.name && line.quantity > (available ?? 0);
          const priced = line.name ? preview.lines[index] : null;

          return <div key={index} className="rounded-[10px] border border-[var(--line)] p-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <select value={line.name} onChange={e => chooseProduct(index, e.target.value)}
                  aria-label="Product" className="select">
                  <option value="">Choose a product</option>
                  {products.map(product => <option key={product._id} value={product.name}>{product.name}</option>)}
                </select>
                {line.name && (
                  <p className={`mt-1 text-xs ${short ? "font-semibold text-rose-700" : "text-[var(--muted)]"}`}>
                    {available === undefined ? "No stock recorded" : `${available} in stock`}
                    {line.hsnCode ? ` · HSN ${line.hsnCode}` : ""}
                  </p>
                )}
              </div>
              {lines.length > 1 && (
                <button type="button" onClick={() => setLines(current => current.filter((_, i) => i !== index))}
                  aria-label="Remove line" className="tap grid shrink-0 place-items-center rounded-[10px] text-rose-600">
                  <Trash2 size={16} />
                </button>
              )}
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Field label="Quantity">
                <input type="number" min={1} step={1} value={line.quantity} className="input"
                  onChange={e => setLine(index, { quantity: Math.max(0, Number(e.target.value) || 0) })} />
              </Field>
              <Field label={`Rate${ratesIncludeTax ? " (incl. GST)" : ""}`}>
                <input type="number" min={0} step="0.01" value={line.rate} className="input"
                  onChange={e => setLine(index, { rate: Math.max(0, Number(e.target.value) || 0) })} />
              </Field>
              <Field label="Discount">
                <div className="flex gap-1">
                  <input type="number" min={0} step="0.01" value={line.discountValue} aria-label="Discount value"
                    className="input min-w-0 flex-1"
                    onChange={e => setLine(index, { discountValue: Math.max(0, Number(e.target.value) || 0) })} />
                  <select value={line.discountType} aria-label="Discount type" className="select w-16 shrink-0 px-2"
                    onChange={e => setLine(index, { discountType: e.target.value as DiscountType })}>
                    <option value="PERCENT">%</option>
                    <option value="AMOUNT">₹</option>
                  </select>
                </div>
              </Field>
              <Field label="GST">
                <select value={line.gstRate} disabled={!taxed} aria-label="GST rate" className="select"
                  onChange={e => setLine(index, { gstRate: Number(e.target.value) })}>
                  {GST_RATES.map(rate => <option key={rate} value={rate}>{rate}%</option>)}
                </select>
              </Field>
            </div>

            {priced && (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] pt-2 text-xs">
                <span className="text-[var(--muted)]">
                  {formatMoney(priced.gross)}
                  {priced.discount > 0 && ` − ${formatMoney(priced.discount)} discount`}
                  {taxed && ` + ${formatMoney(priced.taxAmount)} GST`}
                </span>
                <span className="font-semibold">{formatMoney(priced.total)}</span>
              </div>
            )}
          </div>;
        })}
      </div>

      {shortages.length > 0 && (
        <Notice tone="error">
          <span className="flex items-start gap-2">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <span>Not enough stock for {shortages.map(row => `${row.name} (${row.have} left, ${row.need} billed)`).join(", ")}.
              You can still raise the bill — the shortfall will show on the inventory screen until stock is received.</span>
          </span>
        </Notice>
      )}
    </Card>

    <Card className="space-y-3 p-5">
      <h2 className="text-sm font-semibold">Totals</h2>
      <dl className="space-y-1.5 text-sm">
        <Row label="Subtotal" value={preview.totals.subtotal} />
        {preview.totals.totalDiscount > 0 && <Row label="Discount" value={-preview.totals.totalDiscount} />}
        <Row label="Taxable value" value={preview.totals.taxableValue} />
        {taxed && !interState && <>
          <Row label="CGST" value={preview.totals.cgstTotal} />
          <Row label="SGST" value={preview.totals.sgstTotal} />
        </>}
        {taxed && interState && <Row label="IGST" value={preview.totals.igstTotal} />}
        {preview.totals.roundOff !== 0 && <Row label="Round off" value={preview.totals.roundOff} />}
        <div className="flex items-center justify-between border-t border-[var(--line)] pt-2 text-base font-semibold">
          <dt>Total payable</dt><dd>{formatMoney(preview.totals.grandTotal)}</dd>
        </div>
      </dl>
      {taxed && placeOfSupply && (
        <Badge tone={interState ? "warn" : "info"}>
          {interState ? "Inter-state · IGST" : "Intra-state · CGST + SGST"} · {stateName(placeOfSupply)}
        </Badge>
      )}
    </Card>

    <Card className="space-y-4 p-5">
      <label className="flex items-center gap-2.5 text-sm font-semibold">
        <input type="checkbox" checked={collectNow} className="size-4"
          onChange={e => {
            setCollectNow(e.target.checked);
            if (e.target.checked && !paidAmount) setPaidAmount(preview.totals.grandTotal);
          }} />
        Money received with this bill
      </label>

      {collectNow && <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Amount">
          <input type="number" min={0} max={preview.totals.grandTotal} step="0.01" value={paidAmount} className="input"
            onChange={e => setPaidAmount(Math.max(0, Number(e.target.value) || 0))} />
        </Field>
        <Field label="Mode">
          <select value={paidMode} onChange={e => setPaidMode(e.target.value as PaymentMode)} className="select">
            {PAYMENT_MODES.map(mode => <option key={mode}>{mode}</option>)}
          </select>
        </Field>
        <Field label="Reference" hint="Cheque or transaction number">
          <input value={paidReference} onChange={e => setPaidReference(e.target.value)} className="input" />
        </Field>
      </div>}

      <Field label="Notes on the bill">
        <textarea value={notes} onChange={e => setNotes(e.target.value)} className="textarea"
          placeholder="Order reference, delivery details…" />
      </Field>
      <Field label="Terms" hint="Printed at the foot of the bill">
        <textarea value={terms} onChange={e => setTerms(e.target.value)} className="textarea" />
      </Field>
    </Card>

    {error && <Notice tone="error">{error}</Notice>}

    {/* Pinned: the totals are above and the decision belongs with them. */}
    <div className="sticky bottom-0 -mx-4 border-t border-[var(--line)] bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-[var(--muted)]">{filled.length} line{filled.length === 1 ? "" : "s"}</p>
          <p className="truncate text-lg font-semibold">{formatMoney(preview.totals.grandTotal)}</p>
        </div>
        <Button onClick={submit} busy={busy} disabled={!filled.length}>
          {busy ? "Raising…" : "Raise bill"}
        </Button>
      </div>
    </div>

    {/* Added without leaving the half-typed bill, and selected straight away. */}
    {addingCustomer && <CustomerForm customer={null} onClose={() => setAddingCustomer(false)}
      onSaved={saved => { setCustomer(saved); setAddingCustomer(false); }} />}
  </div>;
}

function Row({ label, value }: { label: string; value: number }) {
  return <div className="flex items-center justify-between">
    <dt className="text-[var(--muted)]">{label}</dt>
    <dd>{value < 0 ? `− ${formatMoney(Math.abs(value))}` : formatMoney(value)}</dd>
  </div>;
}

/** The buyer once chosen, with a way back to the search. */
function ChosenParty({ title, subtitle, onClear }: { title: string; subtitle: string; onClear: () => void }) {
  return <div className="flex items-center gap-3 rounded-[10px] border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2.5">
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-semibold">{title}</p>
      <p className="truncate text-xs text-[var(--muted)]">{subtitle || "No address on record"}</p>
    </div>
    <button type="button" onClick={onClear} aria-label="Choose somebody else"
      className="tap grid shrink-0 place-items-center rounded-[10px] text-[var(--muted)]"><X size={16} /></button>
  </div>;
}

function TypeChoice({ active, disabled, onClick, title, description }: {
  active: boolean; disabled?: boolean; onClick: () => void; title: string; description: string;
}) {
  return <button type="button" onClick={onClick} disabled={disabled}
    className={`rounded-[10px] border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
      active ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-[var(--line-2)] bg-white"
    }`}>
    <p className="text-sm font-semibold">{title}</p>
    <p className="mt-0.5 text-xs text-[var(--muted)]">{description}</p>
  </button>;
}
