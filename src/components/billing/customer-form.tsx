"use client";

import { useState } from "react";
import { Button, Field, Notice } from "@/components/ui/kit";
import { Modal } from "@/components/ui/modal";
import { CUSTOMER_TYPES, isGstin, stateCodeOfGstin, stateName, STATES, type CustomerType } from "@/lib/billing/constants";
import type { CustomerRecord } from "@/lib/billing/customers";

/**
 * Add or edit a trade buyer. Shown as a dialog in the directory and again from
 * inside the bill form, so a stockist who turns up mid-sale can be added
 * without abandoning a half-typed invoice.
 */
export function CustomerForm({ customer, onClose, onSaved }: {
  customer: CustomerRecord | null;
  onClose: () => void;
  onSaved: (saved: CustomerRecord, text: string) => void;
}) {
  const [type, setType] = useState<CustomerType>(customer?.type ?? "Stockist");
  const [name, setName] = useState(customer?.name ?? "");
  const [businessName, setBusinessName] = useState(customer?.businessName ?? "");
  const [contactPerson, setContactPerson] = useState(customer?.contactPerson ?? "");
  const [phone, setPhone] = useState(customer?.phones?.[0] ?? "");
  const [email, setEmail] = useState(customer?.email ?? "");
  const [address, setAddress] = useState(customer?.address ?? "");
  const [city, setCity] = useState(customer?.city ?? "");
  const [pinCode, setPinCode] = useState(customer?.pinCode ?? "");
  const [stateCode, setStateCode] = useState(customer?.stateCode ?? "");
  const [gstin, setGstin] = useState(customer?.gstin ?? "");
  const [drugLicenceNo, setDrugLicenceNo] = useState(customer?.drugLicenceNo ?? "");
  const [creditPeriod, setCreditPeriod] = useState(customer?.creditPeriod ?? 0);
  const [notes, setNotes] = useState(customer?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const gstinValid = !gstin.trim() || isGstin(gstin);

  async function submit() {
    if (name.trim().length < 2) { setError("Enter the customer's name"); return; }
    if (!gstinValid) { setError("That GSTIN is not a valid 15-character number"); return; }

    setBusy(true); setError("");
    try {
      const response = await fetch(customer ? `/api/customers/${customer._id}` : "/api/customers", {
        method: customer ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type,
          name: name.trim(),
          businessName: businessName.trim() || undefined,
          contactPerson: contactPerson.trim() || undefined,
          phones: phone.trim() ? [phone.trim()] : [],
          email: email.trim() || undefined,
          address: address.trim() || undefined,
          city: city.trim() || undefined,
          pinCode: pinCode.trim() || undefined,
          stateCode,
          gstin: gstin.trim().toUpperCase(),
          drugLicenceNo: drugLicenceNo.trim() || undefined,
          creditPeriod,
          notes: notes.trim() || undefined
        })
      });
      const json = await response.json() as { error?: string; data?: CustomerRecord };
      if (!response.ok || !json.data) throw new Error(json.error ?? "Could not save this customer");
      onSaved(json.data, customer ? `${name.trim()} updated.` : `${name.trim()} added.`);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not save this customer");
      setBusy(false);
    }
  }

  return <Modal title={customer ? "Edit customer" : "Add customer"}
    description="Anyone you supply who is not a doctor on your visiting list — a stockist, a distributor, a chemist, a hospital or a private buyer."
    onClose={onClose}
    footer={<Button onClick={submit} busy={busy} className="w-full">
      {busy ? "Saving…" : customer ? "Save changes" : "Add customer"}
    </Button>}>
    <div className="space-y-4">
      <Field label="Type">
        <select value={type} onChange={e => setType(e.target.value as CustomerType)} className="select">
          {CUSTOMER_TYPES.map(value => <option key={value}>{value}</option>)}
        </select>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" hint="The name the bill is made out to">
          <input value={name} onChange={e => setName(e.target.value)} className="input" />
        </Field>
        <Field label="Trading name" hint="Optional, if they trade under another">
          <input value={businessName} onChange={e => setBusinessName(e.target.value)} className="input" />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Contact person"><input value={contactPerson} onChange={e => setContactPerson(e.target.value)} className="input" /></Field>
        <Field label="Phone"><input value={phone} onChange={e => setPhone(e.target.value)} className="input" inputMode="tel" /></Field>
      </div>

      <Field label="Email">
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="input" />
      </Field>

      <Field label="Address">
        <textarea value={address} onChange={e => setAddress(e.target.value)} className="textarea" />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="City"><input value={city} onChange={e => setCity(e.target.value)} className="input" /></Field>
        <Field label="PIN code"><input value={pinCode} onChange={e => setPinCode(e.target.value)} className="input" /></Field>
      </div>

      <Field label="GSTIN" hint={gstinValid ? "Leave blank for an unregistered buyer" : "This is not a valid GSTIN"}>
        <input value={gstin} maxLength={15} className="input" placeholder="27AAPFU0939F1ZV"
          onChange={e => {
            const value = e.target.value.toUpperCase();
            setGstin(value);
            // The state lives in the first two digits, so it fills itself in
            // and cannot end up contradicting the number above it.
            const code = stateCodeOfGstin(value);
            if (code) setStateCode(code);
          }} />
      </Field>

      <Field label="State" hint="Decides the place of supply on their bills">
        <select value={stateCode} onChange={e => setStateCode(e.target.value)} className="select">
          <option value="">Not stated</option>
          {STATES.map(state => <option key={state.code} value={state.code}>{state.name} ({state.code})</option>)}
        </select>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Credit period" hint="Days — proposes the due date on their bills">
          <input type="number" min={0} max={365} value={creditPeriod} className="input"
            onChange={e => setCreditPeriod(Math.max(0, Number(e.target.value) || 0))} />
        </Field>
        <Field label="Drug licence number" hint="Optional, for a chemist or a stockist">
          <input value={drugLicenceNo} onChange={e => setDrugLicenceNo(e.target.value)} className="input" />
        </Field>
      </div>

      <Field label="Notes"><textarea value={notes} onChange={e => setNotes(e.target.value)} className="textarea" /></Field>

      {stateCode && <p className="text-xs text-[var(--muted)]">Place of supply: {stateName(stateCode)}</p>}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  </Modal>;
}
