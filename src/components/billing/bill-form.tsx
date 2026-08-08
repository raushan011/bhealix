"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, Plus, Trash2, X } from "lucide-react";
import { Badge, Button, Card, Field, Notice, PageTitle, Spinner } from "@/components/ui/kit";
import { DoctorPicker, type PickableDoctor } from "@/components/doctors/doctor-picker";
import { CustomerPicker } from "@/components/billing/customer-picker";
import { CustomerForm } from "@/components/billing/customer-form";
import { toDateInput, todayIso } from "@/lib/time";
import { computeInvoice, unitsSupplied, type LineInput } from "@/lib/billing/gst";
import { dueDateFrom } from "@/lib/billing/numbering";
import { customerTitle, type CustomerRecord } from "@/lib/billing/customers";
import type { InvoiceRecord } from "@/lib/billing/types";
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
  name: "", hsnCode: "", unit: "Pcs", quantity: 1, freeQuantity: 0, rate: 0,
  discountType: "PERCENT", discountValue: 0, gstRate: 0
});

/**
 * How the bill is settled at the moment it is raised.
 *
 * An explicit choice rather than a tick-box, because the tick-box version
 * pre-filled the full amount: ticking it to record a part payment, and not
 * noticing the figure already in the box, quietly marked the whole bill paid.
 */
const SETTLEMENTS = [
  { key: "DUE", title: "Nothing yet", description: "Payment is due later" },
  { key: "PART", title: "Part payment", description: "Some money taken now" },
  { key: "FULL", title: "Paid in full", description: "Settled on the spot" }
] as const;
type Settlement = (typeof SETTLEMENTS)[number]["key"];

/**
 * Raising a bill, and editing one already raised.
 *
 * The same form for both: what a bill needs is the same either way, and two
 * copies of a form this size would drift apart within a month. Editing is only
 * offered while nothing has been received — the server enforces that too.
 */
export function BillForm({ invoice }: { invoice?: InvoiceRecord | null }) {
  const router = useRouter();
  const editing = Boolean(invoice);

  const [products, setProducts] = useState<Product[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [stock, setStock] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);

  const [partySource, setPartySource] = useState<PartySource>(invoice?.partySource ?? "Doctor");
  const [doctor, setDoctor] = useState<PickableDoctor | null>(
    invoice?.doctor ? (invoice.doctor as unknown as PickableDoctor) : null);
  const [customer, setCustomer] = useState<CustomerRecord | null>(
    invoice?.customer ? (invoice.customer as unknown as CustomerRecord) : null);
  const [addingCustomer, setAddingCustomer] = useState(false);
  // A one-off buyer is typed here and nowhere else — no directory record.
  const [oneOff, setOneOff] = useState({
    name: invoice?.partySource === "One-off" ? invoice.billTo?.name ?? "" : "",
    type: invoice?.billTo?.type ?? "Individual",
    phone: invoice?.billTo?.phone ?? "",
    address: invoice?.billTo?.address ?? "",
    city: invoice?.billTo?.city ?? "",
    pinCode: invoice?.billTo?.pinCode ?? ""
  });
  const [employee, setEmployee] = useState(invoice?.employee?._id ?? "");
  const [taxed, setTaxed] = useState(invoice?.taxed ?? true);
  const [ratesIncludeTax, setRatesIncludeTax] = useState(invoice?.ratesIncludeTax ?? false);
  const [gstin, setGstin] = useState(invoice?.billTo?.gstin ?? "");
  const [placeOfSupply, setPlaceOfSupply] = useState(invoice?.placeOfSupply?.code ?? "");

  const [invoiceDate, setInvoiceDate] = useState(() => invoice ? toDateInput(invoice.invoiceDate) : todayIso());
  const [paymentTerms, setPaymentTerms] = useState(invoice?.paymentTerms ?? 0);
  const [dueDate, setDueDate] = useState(() => invoice?.dueDate ? toDateInput(invoice.dueDate) : todayIso());
  const [followUpDate, setFollowUpDate] = useState(() => invoice?.followUpDate ? toDateInput(invoice.followUpDate) : "");

  const [lines, setLines] = useState<Line[]>(() => invoice?.items?.length
    ? invoice.items.map(item => ({
        name: item.name, hsnCode: item.hsnCode ?? "", unit: item.unit ?? "Pcs",
        quantity: item.quantity, freeQuantity: item.freeQuantity ?? 0, rate: item.rate,
        discountType: item.discountType, discountValue: item.discountValue, gstRate: item.gstRate
      }))
    : [blankLine()]);
  const [notes, setNotes] = useState(invoice?.notes ?? "");
  const [terms, setTerms] = useState(invoice?.terms ?? "");

  const [settlement, setSettlement] = useState<Settlement>("DUE");
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
        // House defaults only seed a brand-new bill. Applying them to one being
        // edited would quietly rewrite figures the bill was raised with.
        if (!invoice) {
          setRatesIncludeTax(loaded.ratesIncludeTax);
          setPaymentTerms(loaded.defaultPaymentTerms ?? 0);
          setDueDate(dueDateFrom(todayIso(), loaded.defaultPaymentTerms ?? 0));
          setPlaceOfSupply(loaded.stateCode ?? "");
          setTerms(loaded.terms ?? "");
          // Without a GSTIN there is nothing to charge tax under, so the bill
          // starts as a bill of supply rather than as an invoice that cannot save.
          if (!loaded.gstin) setTaxed(false);
        }
      }
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loads once; `invoice` is the bill being edited and does not change under us.
  }, []);

  /**
   * Choosing a buyer fills in whatever billing details their record already
   * holds. Skipped on the first render of an edit, where the bill's own stored
   * details are the ones that count — the buyer's record may have moved on
   * since, and a raised bill must keep what it was raised with.
   */
  const [buyerTouched, setBuyerTouched] = useState(!editing);

  useEffect(() => {
    if (!doctor || !buyerTouched) return;
    setGstin(doctor.gstin ?? "");
    if (doctor.stateCode) setPlaceOfSupply(doctor.stateCode);
  }, [doctor, buyerTouched]);

  useEffect(() => {
    if (!customer || !buyerTouched) return;
    setGstin(customer.gstin ?? "");
    if (customer.stateCode) setPlaceOfSupply(customer.stateCode);
    // A stockist's own credit terms beat the house default.
    if (customer.creditPeriod) {
      setPaymentTerms(customer.creditPeriod);
      setDueDate(dueDateFrom(invoiceDate, customer.creditPeriod));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the invoice date is read, not tracked: changing it must not re-apply the buyer's terms.
  }, [customer, buyerTouched]);

  /**
   * Switching who the bill is for clears whatever the last buyer contributed.
   * Without this, picking a doctor and then switching to a walk-in would leave
   * the doctor's GSTIN sitting on a bill made out to somebody else.
   */
  useEffect(() => {
    if (!buyerTouched) return;
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
    // Scheme goods come off the same shelf as the billed ones, so they count
    // towards the shortfall even though they are charged for nothing.
    for (const line of filled) wanted.set(line.name, (wanted.get(line.name) ?? 0) + unitsSupplied(line));
    return [...wanted]
      .map(([name, need]) => ({ name, need, have: stock.get(name) ?? 0 }))
      .filter(row => row.need > row.have);
  }, [filled, stock]);

  /** What the bill will actually be saved as, spelled out before it is saved. */
  const settling = settlement === "FULL" ? preview.totals.grandTotal : settlement === "PART" ? paidAmount : 0;

  async function submit() {
    if (partySource === "Doctor" && !doctor) { setError("Choose the doctor this bill is for"); return; }
    if (partySource === "Customer" && !customer) { setError("Choose the customer this bill is for"); return; }
    if (partySource === "One-off" && oneOff.name.trim().length < 2) { setError("Enter the name this bill is for"); return; }
    if (!employee) { setError("Choose the representative this bill belongs to"); return; }
    if (!filled.length) { setError("Add at least one product"); return; }
    if (settlement === "PART" && paidAmount <= 0) { setError("Enter how much was received"); return; }
    if (settlement === "PART" && paidAmount >= preview.totals.grandTotal) {
      setError("That is the whole bill — choose “Paid in full” instead.");
      return;
    }

    setBusy(true); setError("");
    try {
      const response = await fetch(editing ? `/api/invoices/${invoice!._id}` : "/api/invoices", {
        method: editing ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
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
            freeQuantity: Math.max(0, Math.trunc(line.freeQuantity ?? 0)),
            rate: line.rate,
            discountType: line.discountType,
            discountValue: line.discountValue,
            gstRate: taxed ? line.gstRate : 0
          })),
          notes: notes.trim() || undefined,
          terms: terms.trim() || undefined,
          // A payment is only ever sent when one was actually taken. Editing
          // never touches receipts — those are recorded on the bill itself.
          payment: !editing && settling > 0
            ? { amount: settling, mode: paidMode, reference: paidReference.trim() || undefined, paidAt: invoiceDate }
            : undefined
        })
      });
      const json = await response.json() as { error?: string; data?: { _id: string } };
      if (!response.ok) throw new Error(json.error ?? `Could not ${editing ? "save" : "raise"} this bill`);
      router.push(`/admin/billing/${editing ? invoice!._id : json.data?._id}`);
      router.refresh();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : `Could not ${editing ? "save" : "raise"} this bill`);
      setBusy(false);
    }
  }

  if (loading) return <Spinner label="Preparing the bill…" />;

  return <div className="space-y-5 pb-24">
    <Link href={editing ? `/admin/billing/${invoice!._id}` : "/admin/billing"}
      className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--brand)]">
      <ArrowLeft size={16} />{editing ? "Back to the bill" : "Billing"}
    </Link>
    <PageTitle
      title={editing ? `Edit ${invoice!.invoiceNo}` : "New bill"}
      subtitle={editing
        ? "The bill keeps its number. Changing the lines re-prices it and puts the old quantities back into stock."
        : "Products supplied to a doctor, a trade buyer or a one-off customer"} />

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
        {(["Doctor", "Customer", "One-off"] as const).map(source => (
          <TypeChoice key={source} active={partySource === source}
            onClick={() => { setBuyerTouched(true); setPartySource(source); }}
            title={source}
            description={source === "Doctor" ? "From your visiting directory"
              : source === "Customer" ? "Stockist, distributor, chemist, hospital"
              : "A buyer you will not bill again"} />
        ))}
      </div>

      {partySource === "Doctor" && (
        <Field label="Doctor">
          {doctor ? (
            <ChosenParty title={doctor.name}
              subtitle={[doctor.clinicName, doctor.fullAddress || doctor.area, doctor.city].filter(Boolean).join(" · ") || "No address on record"}
              onClear={() => { setBuyerTouched(true); setDoctor(null); }} />
          ) : (
            <DoctorPicker requireLocation={false} placeholder="Search the doctor to bill"
              onSelect={chosen => { setBuyerTouched(true); setDoctor(chosen); }} />
          )}
        </Field>
      )}

      {partySource === "Customer" && (
        <Field label="Customer">
          {customer ? (
            <ChosenParty title={customerTitle(customer)}
              subtitle={[customer.type, customer.address, customer.city, customer.gstin && `GSTIN ${customer.gstin}`]
                .filter(Boolean).join(" · ")}
              onClear={() => { setBuyerTouched(true); setCustomer(null); }} />
          ) : <>
            <CustomerPicker onSelect={chosen => { setBuyerTouched(true); setCustomer(chosen); }} />
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
          const supplied = unitsSupplied(line);
          const short = line.name && supplied > (available ?? 0);
          const priced = line.name ? preview.lines[index] : null;
          // A line is what is being charged for; the scheme rides along with it.
          // Free goods with nothing billed beside them would be dropped on save,
          // so say that here rather than letting the line quietly disappear.
          const freeOnly = Boolean(line.name) && (line.freeQuantity ?? 0) > 0 && line.quantity <= 0;

          return <div key={index} className="rounded-[10px] border border-[var(--line)] p-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <select value={line.name} onChange={e => chooseProduct(index, e.target.value)}
                  aria-label="Product" className="select">
                  <option value="">Choose a product</option>
                  {products.map(product => <option key={product._id} value={product.name}>{product.name}</option>)}
                </select>
                {line.name && (
                  <p className={`mt-1 text-xs ${short ? "font-semibold text-[var(--danger-ink)]" : "text-[var(--muted)]"}`}>
                    {available === undefined ? "No stock recorded" : `${available} in stock`}
                    {line.hsnCode ? ` · HSN ${line.hsnCode}` : ""}
                  </p>
                )}
              </div>
              {lines.length > 1 && (
                <button type="button" onClick={() => setLines(current => current.filter((_, i) => i !== index))}
                  aria-label="Remove line" className="tap grid shrink-0 place-items-center rounded-[10px] text-[var(--danger-ink)]">
                  <Trash2 size={16} />
                </button>
              )}
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              <Field label="Quantity">
                <input type="number" min={1} step={1} value={line.quantity} className="input"
                  onChange={e => setLine(index, { quantity: Math.max(0, Number(e.target.value) || 0) })} />
              </Field>
              {/* The "+1" of a 10+1. Charged for nothing, still off the shelf. */}
              <Field label="Free" hint={(line.freeQuantity ?? 0) > 0 ? `${line.quantity}+${line.freeQuantity} scheme` : undefined}>
                <input type="number" min={0} step={1} value={line.freeQuantity ?? 0} className="input"
                  onChange={e => setLine(index, { freeQuantity: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })} />
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

            {freeOnly && (
              <p className="mt-2 text-xs font-semibold text-[var(--warn-ink)]">
                Free goods ride along with something billed. Enter the quantity being charged for, or
                bill one unit at a zero rate if the whole line is a giveaway.
              </p>
            )}

            {priced && (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] pt-2 text-xs">
                <span className="text-[var(--muted)]">
                  {formatMoney(priced.gross)}
                  {priced.discount > 0 && ` − ${formatMoney(priced.discount)} discount`}
                  {taxed && ` + ${formatMoney(priced.taxAmount)} GST`}
                  {(line.freeQuantity ?? 0) > 0 && ` · ${line.freeQuantity} free`}
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
            <span>Not enough stock for {shortages.map(row => `${row.name} (${row.have} left, ${row.need} going out)`).join(", ")}.
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

    {/* Receipts on an existing bill are recorded against the bill itself, so
        editing never touches the money already taken. */}
    {!editing && <Card className="space-y-4 p-5">
      <h2 className="text-sm font-semibold">Money taken now</h2>

      <div className="grid gap-2 sm:grid-cols-3">
        {SETTLEMENTS.map(option => (
          <TypeChoice key={option.key} active={settlement === option.key}
            onClick={() => { setSettlement(option.key); setPaidAmount(0); }}
            title={option.title} description={option.description} />
        ))}
      </div>

      {settlement === "PART" && (
        <Field label="Amount received" hint={`Less than the ${formatMoney(preview.totals.grandTotal)} total`}>
          <input type="number" min={0} max={preview.totals.grandTotal} step="0.01" placeholder="0.00" className="input"
            value={paidAmount || ""} onChange={e => setPaidAmount(Math.max(0, Number(e.target.value) || 0))} />
        </Field>
      )}

      {settlement !== "DUE" && <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Mode">
          <select value={paidMode} onChange={e => setPaidMode(e.target.value as PaymentMode)} className="select">
            {PAYMENT_MODES.map(mode => <option key={mode}>{mode}</option>)}
          </select>
        </Field>
        <Field label="Reference" hint="Cheque or transaction number">
          <input value={paidReference} onChange={e => setPaidReference(e.target.value)} className="input" />
        </Field>
      </div>}

      {/* Said plainly, because getting this wrong is what made bills look
          settled that were not. */}
      <p className="rounded-[10px] bg-[var(--surface-2)] px-3 py-2.5 text-sm">
        This bill will be saved as{" "}
        <strong>
          {settling <= 0 ? "Unpaid"
            : settling + 0.005 >= preview.totals.grandTotal ? "Paid"
            : "Partially paid"}
        </strong>
        {settling > 0 && settling < preview.totals.grandTotal
          ? ` — ${formatMoney(preview.totals.grandTotal - settling)} still to collect`
          : settling <= 0 && dueDate ? `, due ${dueDate}` : ""}.
      </p>
    </Card>}

    <Card className="space-y-4 p-5">
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
    <div className="sticky bottom-0 -mx-4 border-t border-[var(--line)] bg-[var(--surface-veil)] px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-[var(--muted)]">{filled.length} line{filled.length === 1 ? "" : "s"}</p>
          <p className="truncate text-lg font-semibold">{formatMoney(preview.totals.grandTotal)}</p>
        </div>
        <Button onClick={submit} busy={busy} disabled={!filled.length}>
          {busy ? "Saving…" : editing ? "Save changes" : "Raise bill"}
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
      active ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-[var(--line-2)] bg-[var(--surface)]"
    }`}>
    <p className="text-sm font-semibold">{title}</p>
    <p className="mt-0.5 text-xs text-[var(--muted)]">{description}</p>
  </button>;
}
