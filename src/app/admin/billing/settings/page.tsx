"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button, Card, Field, Notice, PageTitle, Spinner } from "@/components/ui/kit";
import { PaymentQr } from "@/components/billing/payment-qr";
import { formatInvoiceNo, financialYear } from "@/lib/billing/numbering";
import { isGstin, stateCodeOfGstin, stateName, STATES } from "@/lib/billing/constants";

type Settings = {
  legalName: string; tradeName?: string; address?: string; city?: string;
  state?: string; stateCode?: string; pinCode?: string;
  gstin?: string; pan?: string; phone?: string; email?: string; website?: string; drugLicenceNo?: string;
  bankName?: string; bankAccountName?: string; bankAccountNo?: string; bankIfsc?: string;
  bankBranch?: string; upiId?: string;
  /** Set by the QR upload, which travels on its own — see components/billing/payment-qr. */
  paymentQrType?: string; paymentQrBytes?: number; paymentQrUpdatedAt?: string; paymentQrLabel?: string;
  invoicePrefix?: string; defaultPaymentTerms?: number; defaultGstRate?: number;
  ratesIncludeTax?: boolean; terms?: string; signatoryName?: string;
  showReceiverSignature?: boolean; receiverSignatureLabel?: string;
};

/**
 * The seller's own details. Everything a tax invoice must carry about the
 * business raising it lives here, so an accountant can correct a GSTIN or a
 * bank account without anyone touching the code.
 */
export default function BillingSettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/billing/settings").then(r => r.json())
      .then((json: { data?: { settings: Settings } }) => setSettings(json.data?.settings ?? { legalName: "BHEALIX" }));
  }, []);

  if (!settings) return <Spinner label="Loading billing settings…" />;

  const set = (patch: Partial<Settings>) => setSettings(current => ({ ...current!, ...patch }));
  const gstinValid = !settings.gstin || isGstin(settings.gstin);

  async function save() {
    if (!gstinValid) { setNotice({ tone: "error", text: "That GSTIN is not a valid 15-character number." }); return; }
    setBusy(true); setNotice(null);
    try {
      const response = await fetch("/api/billing/settings", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...settings,
          gstin: settings!.gstin?.trim().toUpperCase() ?? "",
          defaultPaymentTerms: Number(settings!.defaultPaymentTerms) || 0,
          defaultGstRate: Number(settings!.defaultGstRate) || 0
        })
      });
      const json = await response.json() as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "Could not save these settings");
      setNotice({ tone: "success", text: "Billing settings saved." });
    } catch (problem) {
      setNotice({ tone: "error", text: problem instanceof Error ? problem.message : "Could not save these settings" });
    }
    setBusy(false);
  }

  return <div className="space-y-5 pb-20">
    <Link href="/admin/billing" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--brand)]">
      <ArrowLeft size={16} />Billing
    </Link>
    <PageTitle title="Billing settings" subtitle="Your own details, as they appear on every bill you raise" />

    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

    {!settings.gstin && (
      <Notice tone="info">
        Until a GSTIN is saved here, bills can only be raised as a bill of supply with no GST charged.
      </Notice>
    )}

    <Card className="space-y-4 p-5">
      <h2 className="text-sm font-semibold">The business</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Legal name" hint="As registered">
          <input value={settings.legalName ?? ""} onChange={e => set({ legalName: e.target.value })} className="input" />
        </Field>
        <Field label="Trade name" hint="Printed on the bill if different">
          <input value={settings.tradeName ?? ""} onChange={e => set({ tradeName: e.target.value })} className="input" />
        </Field>
      </div>
      <Field label="Address">
        <textarea value={settings.address ?? ""} onChange={e => set({ address: e.target.value })} className="textarea" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="City"><input value={settings.city ?? ""} onChange={e => set({ city: e.target.value })} className="input" /></Field>
        <Field label="PIN code"><input value={settings.pinCode ?? ""} onChange={e => set({ pinCode: e.target.value })} className="input" /></Field>
        <Field label="Phone"><input value={settings.phone ?? ""} onChange={e => set({ phone: e.target.value })} className="input" /></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Email"><input type="email" value={settings.email ?? ""} onChange={e => set({ email: e.target.value })} className="input" /></Field>
        <Field label="Drug licence number" hint="Optional, printed on the bill">
          <input value={settings.drugLicenceNo ?? ""} onChange={e => set({ drugLicenceNo: e.target.value })} className="input" />
        </Field>
      </div>
    </Card>

    <Card className="space-y-4 p-5">
      <h2 className="text-sm font-semibold">Tax</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="GSTIN" hint={gstinValid ? "Leave blank if you are not registered" : "This is not a valid GSTIN"}>
          <input value={settings.gstin ?? ""} maxLength={15} className="input" placeholder="27AAPFU0939F1ZV"
            onChange={e => {
              const value = e.target.value.toUpperCase();
              // The state is the first two digits of the number, so it fills
              // itself in and can never contradict the GSTIN above it.
              const code = stateCodeOfGstin(value);
              set(code ? { gstin: value, stateCode: code, state: stateName(code) } : { gstin: value });
            }} />
        </Field>
        <Field label="PAN"><input value={settings.pan ?? ""} onChange={e => set({ pan: e.target.value.toUpperCase() })} className="input" /></Field>
      </div>
      <Field label="Your state" hint="Decides whether a bill carries CGST and SGST or IGST">
        <select value={settings.stateCode ?? ""} className="select"
          onChange={e => set({ stateCode: e.target.value, state: stateName(e.target.value) })}>
          <option value="">Choose a state</option>
          {STATES.map(state => <option key={state.code} value={state.code}>{state.name} ({state.code})</option>)}
        </select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Default GST rate" hint="Used for a product with no rate of its own">
          <input type="number" min={0} max={50} value={settings.defaultGstRate ?? 18} className="input"
            onChange={e => set({ defaultGstRate: Number(e.target.value) })} />
        </Field>
        <Field label="Default credit period" hint="Days, used to propose a payment due date">
          <input type="number" min={0} max={365} value={settings.defaultPaymentTerms ?? 0} className="input"
            onChange={e => set({ defaultPaymentTerms: Number(e.target.value) })} />
        </Field>
      </div>
      <label className="flex items-center gap-2.5 text-sm">
        <input type="checkbox" checked={settings.ratesIncludeTax ?? false} className="size-4"
          onChange={e => set({ ratesIncludeTax: e.target.checked })} />
        <span>Product prices already include GST
          <span className="block text-xs text-[var(--muted)]">New bills start with this setting; it can be changed on any one bill</span>
        </span>
      </label>
    </Card>

    <Card className="space-y-4 p-5">
      <h2 className="text-sm font-semibold">Numbering</h2>
      <Field label="Bill number prefix"
        hint={`Next bill will read ${formatInvoiceNo(settings.invoicePrefix ?? "BHX", financialYear(), 1)} — the series restarts each financial year`}>
        <input value={settings.invoicePrefix ?? ""} maxLength={12} className="input"
          onChange={e => set({ invoicePrefix: e.target.value.toUpperCase() })} />
      </Field>
    </Card>

    <Card className="space-y-4 p-5">
      <h2 className="text-sm font-semibold">Payment details</h2>
      <p className="-mt-2 text-xs text-[var(--muted)]">Printed on the bill so a doctor can pay without asking.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Account name"><input value={settings.bankAccountName ?? ""} onChange={e => set({ bankAccountName: e.target.value })} className="input" /></Field>
        <Field label="Bank"><input value={settings.bankName ?? ""} onChange={e => set({ bankName: e.target.value })} className="input" /></Field>
        <Field label="Account number"><input value={settings.bankAccountNo ?? ""} onChange={e => set({ bankAccountNo: e.target.value })} className="input" /></Field>
        <Field label="IFSC"><input value={settings.bankIfsc ?? ""} onChange={e => set({ bankIfsc: e.target.value.toUpperCase() })} className="input" /></Field>
        <Field label="Branch" hint="Optional"><input value={settings.bankBranch ?? ""} onChange={e => set({ bankBranch: e.target.value })} className="input" /></Field>
        <Field label="UPI ID"><input value={settings.upiId ?? ""} onChange={e => set({ upiId: e.target.value })} className="input" placeholder="bhealix@okhdfcbank" /></Field>
      </div>

      <div className="border-t border-[var(--line)] pt-4">
        {/* The image is uploaded the moment it is chosen — it does not wait for
            Save at the foot of the page, and says so rather than leaving an
            administrator wondering which half of this card is saved. */}
        <PaymentQr initialType={settings.paymentQrType} initialBytes={settings.paymentQrBytes}
          initialUpdatedAt={settings.paymentQrUpdatedAt} />
        <div className="mt-4">
          <Field label="Caption under the QR" hint="Saved with the rest of these settings">
            <input value={settings.paymentQrLabel ?? ""} maxLength={120} className="input"
              placeholder="Scan with any UPI app"
              onChange={e => set({ paymentQrLabel: e.target.value })} />
          </Field>
        </div>
      </div>
    </Card>

    <Card className="space-y-4 p-5">
      <h2 className="text-sm font-semibold">Foot of the bill</h2>
      <Field label="Terms and conditions" hint="Copied onto every new bill, where it can still be edited">
        <textarea value={settings.terms ?? ""} onChange={e => set({ terms: e.target.value })} className="textarea"
          placeholder="Goods once sold will not be taken back. Interest at 18% per annum on overdue amounts." />
      </Field>
      <Field label="Authorised signatory">
        <input value={settings.signatoryName ?? ""} onChange={e => set({ signatoryName: e.target.value })} className="input" />
      </Field>

      <div className="space-y-3 border-t border-[var(--line)] pt-4">
        <label className="flex items-center gap-2.5 text-sm">
          <input type="checkbox" checked={settings.showReceiverSignature !== false} className="size-4"
            onChange={e => set({ showReceiverSignature: e.target.checked })} />
          <span>Leave a space for the receiver to sign
            <span className="block text-xs text-[var(--muted)]">
              A ruled line beside your own signatory, for whoever takes delivery of the goods
            </span>
          </span>
        </label>
        {settings.showReceiverSignature !== false && (
          <Field label="Wording above that line" hint="Left blank, the bill prints “Received by”">
            <input value={settings.receiverSignatureLabel ?? ""} maxLength={60} className="input"
              placeholder="Received by"
              onChange={e => set({ receiverSignatureLabel: e.target.value })} />
          </Field>
        )}
      </div>
    </Card>

    <div className="sticky bottom-0 -mx-4 border-t border-[var(--line)] bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
      <Button onClick={save} busy={busy} className="w-full sm:w-auto">{busy ? "Saving…" : "Save settings"}</Button>
    </div>
  </div>;
}
