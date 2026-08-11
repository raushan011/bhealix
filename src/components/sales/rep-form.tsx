"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { Button, Field, Notice } from "@/components/ui/kit";
import { Modal } from "@/components/ui/modal";
import { isRepCode, normaliseCode } from "@/lib/sales/coupons";
import { PAYOUT_MODES } from "@/lib/sales/constants";
import type { CommissionRule } from "@/lib/sales/commission";
import type { RepCoupon, SalesRepRecord } from "@/lib/sales/types";

type Coupon = RepCoupon;

type Draft = {
  name: string; code: string; phone: string; email: string;
  payMethod: string; upiId: string;
  bankName: string; bankAccountName: string; bankAccountNo: string; bankIfsc: string;
  panNumber: string; joinedAt: string; notes: string;
};

const emptyDraft = (): Draft => ({
  name: "", code: "", phone: "", email: "",
  payMethod: "UPI", upiId: "",
  bankName: "", bankAccountName: "", bankAccountNo: "", bankIfsc: "",
  panNumber: "", joinedAt: "", notes: ""
});

const draftFrom = (rep: SalesRepRecord): Draft => ({
  name: rep.name ?? "", code: rep.code ?? "", phone: rep.phone ?? "", email: rep.email ?? "",
  payMethod: rep.payMethod ?? "UPI", upiId: rep.upiId ?? "",
  bankName: rep.bankName ?? "", bankAccountName: rep.bankAccountName ?? "",
  bankAccountNo: rep.bankAccountNo ?? "", bankIfsc: rep.bankIfsc ?? "",
  panNumber: rep.panNumber ?? "", joinedAt: rep.joinedAt?.slice(0, 10) ?? "", notes: rep.notes ?? ""
});

/**
 * Adding a rep, or correcting one.
 *
 * The code is the load-bearing field and the form says so: it shows, live, the
 * coupon codes that will be created from it. Somebody typing RAUSHAN needs to
 * see RAUSHAN10 and RAUSHAN30 before they save, because those are the codes
 * they then have to create in Shopify by hand — and a mismatch between the two
 * systems is silent until an order arrives with a code nothing recognises.
 *
 * The code cannot be changed afterwards. It is half of every coupon already
 * issued, and orders already attributed point at those codes.
 */
export function RepForm({ rep, onClose, onSaved }: {
  rep?: SalesRepRecord;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [draft, setDraft] = useState<Draft>(rep ? draftFrom(rep) : emptyDraft());
  const [coupons, setCoupons] = useState<Coupon[]>(rep?.coupons?.length ? rep.coupons.map(entry => ({ ...entry })) : []);
  const [rules, setRules] = useState<CommissionRule[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/sales/settings")
      .then(response => response.json())
      .then((json: { data?: { rules?: CommissionRule[] } }) => setRules(json.data?.rules ?? []))
      .catch(() => setRules([]));
  }, []);

  const code = normaliseCode(draft.code);
  const active = useMemo(() => rules.filter(rule => rule.active), [rules]);
  const set = (key: keyof Draft) => (value: string) => setDraft(current => ({ ...current, [key]: value }));

  const setCoupon = (index: number, patch: Partial<Coupon>) =>
    setCoupons(current => current.map((coupon, at) => (at === index ? { ...coupon, ...patch } : coupon)));

  async function save() {
    setBusy(true); setError("");
    try {
      const response = await fetch(rep ? `/api/sales/reps/${rep._id}` : "/api/sales/reps", {
        method: rep ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...draft,
          code: code || undefined,
          email: draft.email || undefined,
          joinedAt: draft.joinedAt || undefined,
          coupons: coupons.filter(coupon => coupon.code.trim() && coupon.suffix),
          // The code is fixed once issued; sending it on an edit would only
          // invite the server to refuse a change nobody asked for.
          ...(rep ? { code: undefined } : {})
        })
      });
      const json = await response.json() as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "Could not save this rep");
      onSaved(rep ? `${draft.name} has been updated.` : `${draft.name} has been added with ${coupons.length} coupon code${coupons.length === 1 ? "" : "s"}.`);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not save this rep");
    } finally {
      setBusy(false);
    }
  }

  const valid = draft.name.trim().length >= 2 && (rep ? true : isRepCode(code));

  return <Modal
    title={rep ? `Edit ${rep.name}` : "Add a sales rep"}
    description={rep ? "The rep code and its coupons cannot be changed" : "Their coupon codes are built from the code you give them"}
    onClose={onClose}
    footer={<div className="flex gap-2">
      <Button tone="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
      <Button className="flex-1" busy={busy} disabled={!valid} onClick={save}>{rep ? "Save changes" : "Add rep"}</Button>
    </div>}>

    <div className="space-y-4">
      <Field label="Name">
        <input className="input" value={draft.name} autoFocus onChange={event => set("name")(event.target.value)} placeholder="Raushan Upadhyay" />
      </Field>

      {rep ? (
        <Field label="Rep code" hint="Fixed once issued — it is half of every coupon they hold.">
          <input className="input" value={rep.code} disabled />
        </Field>
      ) : (
        <Field label="Rep code" hint="Letters and digits, no spaces. This becomes the first part of every coupon.">
          <input className="input" value={draft.code} placeholder="RAUSHAN"
            onChange={event => set("code")(event.target.value.toUpperCase())} />
        </Field>
      )}

      {!rep && code.length > 0 && !isRepCode(code) && (
        <Notice tone="warning">A rep code starts with a letter and has no spaces — RAUSHAN, PRIYA_K.</Notice>
      )}

      {/*
        * Entered by hand, never invented.
        *
        * The CRM does not create discount codes — Shopify does — so generating
        * RAUSHAN10 and RAUSHAN30 here only ever put codes on the record that
        * might not exist over there. The code is whatever Shopify has; the rule
        * it pays under is chosen beside it, so a coupon with no digits in its
        * name works exactly as well as one with them.
        */}
      <div className="space-y-2">
        <p className="text-[13px] font-medium text-[var(--ink-2)]">Coupon codes</p>
        <p className="text-xs text-[var(--muted)]">
          Exactly as they are spelled in Shopify. Attribution is an exact match, so a typo here means orders that earn
          nobody anything.
        </p>

        {coupons.map((coupon, index) => (
          <div key={index} className="grid grid-cols-[1fr_130px_auto] items-center gap-2">
            <input className="input" placeholder="SATHYA30" value={coupon.code}
              onChange={event => setCoupon(index, { code: event.target.value.toUpperCase() })} />
            <select className="select" value={coupon.suffix} onChange={event => setCoupon(index, { suffix: event.target.value })}>
              <option value="">Rule…</option>
              {active.map(rule => <option key={rule.suffix} value={rule.suffix}>{rule.label} ({rule.rate}%)</option>)}
            </select>
            <button aria-label="Remove code" onClick={() => setCoupons(current => current.filter((_, at) => at !== index))}
              className="tap grid place-items-center rounded-[10px] text-[var(--muted)] hover:bg-[var(--surface-2)]">
              <X size={16} />
            </button>
          </div>
        ))}

        <button onClick={() => setCoupons(current => [...current, { code: code ? `${code}` : "", suffix: active[0]?.suffix ?? "", active: true }])}
          className="text-sm font-medium text-[var(--brand)] hover:underline">
          Add a coupon code
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Phone"><input className="input" value={draft.phone} onChange={event => set("phone")(event.target.value)} /></Field>
        <Field label="Email"><input className="input" type="email" value={draft.email} onChange={event => set("email")(event.target.value)} /></Field>
      </div>

      <Field label="Paid by">
        <select className="select" value={draft.payMethod} onChange={event => set("payMethod")(event.target.value)}>
          {PAYOUT_MODES.map(mode => <option key={mode} value={mode}>{mode}</option>)}
        </select>
      </Field>

      {draft.payMethod === "UPI" ? (
        <Field label="UPI ID"><input className="input" value={draft.upiId} onChange={event => set("upiId")(event.target.value)} placeholder="name@bank" /></Field>
      ) : draft.payMethod === "Bank transfer" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Account name"><input className="input" value={draft.bankAccountName} onChange={event => set("bankAccountName")(event.target.value)} /></Field>
          <Field label="Bank"><input className="input" value={draft.bankName} onChange={event => set("bankName")(event.target.value)} /></Field>
          <Field label="Account number"><input className="input" value={draft.bankAccountNo} onChange={event => set("bankAccountNo")(event.target.value)} /></Field>
          <Field label="IFSC"><input className="input" value={draft.bankIfsc} onChange={event => set("bankIfsc")(event.target.value.toUpperCase())} /></Field>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="PAN" hint="For the books, where commission is reportable.">
          <input className="input" value={draft.panNumber} onChange={event => set("panNumber")(event.target.value.toUpperCase())} />
        </Field>
        <Field label="Joined on"><input className="input" type="date" value={draft.joinedAt} onChange={event => set("joinedAt")(event.target.value)} /></Field>
      </div>

      <Field label="Notes"><textarea className="textarea" rows={2} value={draft.notes} onChange={event => set("notes")(event.target.value)} /></Field>

      {error && <Notice tone="error">{error}</Notice>}
    </div>
  </Modal>;
}
