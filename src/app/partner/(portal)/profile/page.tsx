"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, Field, Notice, PageTitle, Spinner } from "@/components/ui/kit";
import { PasswordInput } from "@/components/ui/password-input";
import { PAYOUT_MODES, type PayoutMode } from "@/lib/sales/constants";
import { passwordProblem } from "@/lib/sales/partners";
import type { PartnerOverview } from "@/lib/sales/types";

type Details = {
  phone: string;
  payMethod: PayoutMode;
  upiId: string;
  bankName: string;
  bankAccountName: string;
  bankAccountNo: string;
  bankIfsc: string;
  panNumber: string;
};

/**
 * Where the money should go, and the password that guards it.
 *
 * The rep maintains their own payment details because nobody else knows them —
 * an administrator retyping a UPI id off a WhatsApp message is exactly how a
 * payout reaches the wrong account. What they cannot change from here is their
 * name, their code or their standing: the first is what a payout advice is made
 * out to, the second is printed on coupons already in circulation, and the third
 * is the company's decision about them.
 */
export default function PartnerProfilePage() {
  const [data, setData] = useState<PartnerOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [details, setDetails] = useState<Details | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [me, own] = await Promise.all([
      fetch("/api/partner/me").then(response => response.json() as Promise<{ data?: PartnerOverview }>),
      fetch("/api/partner/profile").then(response => response.json() as Promise<{ data?: Partial<Details> }>)
    ]);
    setData(me.data ?? null);
    setDetails({
      phone: own.data?.phone ?? me.data?.profile.phone ?? "",
      payMethod: (own.data?.payMethod as PayoutMode) ?? "UPI",
      upiId: own.data?.upiId ?? "",
      bankName: own.data?.bankName ?? "",
      bankAccountName: own.data?.bankAccountName ?? "",
      bankAccountNo: own.data?.bankAccountNo ?? "",
      bankIfsc: own.data?.bankIfsc ?? "",
      panNumber: own.data?.panNumber ?? ""
    });
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save(body: Record<string, unknown>, message: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/partner/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const json = await response.json() as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "Could not save");
      setNotice(message);
      return true;
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not save");
      return false;
    } finally { setBusy(false); }
  }

  if (loading || !details) return <Spinner label="Loading your details…" />;
  if (!data) return <Notice tone="error">Could not load your details.</Notice>;

  const { profile, refusal } = data;
  const bank = details.payMethod === "Bank transfer";

  return <div className="space-y-5">
    <PageTitle title="Your details" subtitle={`${profile.name} · ${profile.code}`} />

    {notice && <Notice tone="success">{notice}</Notice>}
    {error && <Notice tone="error">{error}</Notice>}
    {refusal && <Notice tone="warning">{refusal}</Notice>}

    <Card className="space-y-4 p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Where to pay you</p>

      <Field label="Phone">
        <input className="input" type="tel" value={details.phone}
          onChange={event => setDetails({ ...details, phone: event.target.value })} />
      </Field>

      <Field label="How you would like to be paid">
        <select className="select" value={details.payMethod}
          onChange={event => setDetails({ ...details, payMethod: event.target.value as PayoutMode })}>
          {PAYOUT_MODES.map(mode => <option key={mode} value={mode}>{mode}</option>)}
        </select>
      </Field>

      {details.payMethod === "UPI" && (
        <Field label="UPI ID">
          <input className="input" placeholder="name@bank" value={details.upiId}
            onChange={event => setDetails({ ...details, upiId: event.target.value })} />
        </Field>
      )}

      {bank && <>
        <Field label="Account holder's name" hint="Exactly as the bank has it.">
          <input className="input" value={details.bankAccountName}
            onChange={event => setDetails({ ...details, bankAccountName: event.target.value })} />
        </Field>
        <Field label="Bank">
          <input className="input" value={details.bankName}
            onChange={event => setDetails({ ...details, bankName: event.target.value })} />
        </Field>
        <Field label="Account number">
          <input className="input" inputMode="numeric" value={details.bankAccountNo}
            onChange={event => setDetails({ ...details, bankAccountNo: event.target.value })} />
        </Field>
        <Field label="IFSC">
          <input className="input uppercase" value={details.bankIfsc}
            onChange={event => setDetails({ ...details, bankIfsc: event.target.value.toUpperCase() })} />
        </Field>
      </>}

      <Field label="PAN" hint="Needed once your earnings pass the threshold for tax to be deducted.">
        <input className="input uppercase" maxLength={10} value={details.panNumber}
          onChange={event => setDetails({ ...details, panNumber: event.target.value.toUpperCase() })} />
      </Field>

      <Button busy={busy} disabled={Boolean(refusal)} onClick={() => save({ ...details }, "Your payment details have been saved.")}>
        Save details
      </Button>
      {refusal && <p className="text-xs text-[var(--muted)]">These can be changed once your account is approved.</p>}
    </Card>

    <ChangePassword busy={busy} disabled={Boolean(refusal)}
      onSave={(currentPassword, newPassword) => save({ currentPassword, newPassword }, "Your password has been changed.")} />

    <Card className="p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Account</p>
      <p className="mt-2 text-sm text-[var(--ink-2)]">{profile.email}</p>
      <p className="mt-0.5 text-xs text-[var(--muted)]">
        Your email and your code cannot be changed here — ask the company if either is wrong.
      </p>
    </Card>
  </div>;
}

function ChangePassword({ busy, disabled, onSave }: {
  busy: boolean;
  disabled: boolean;
  onSave: (currentPassword: string, newPassword: string) => Promise<boolean>;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const problem = next ? passwordProblem(next) : null;

  return <Card className="space-y-4 p-5">
    <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Password</p>

    <Field label="Current password">
      <PasswordInput autoComplete="current-password" value={current} onChange={event => setCurrent(event.target.value)} />
    </Field>
    <Field label="New password">
      <PasswordInput autoComplete="new-password" value={next} onChange={event => setNext(event.target.value)} />
    </Field>
    {problem && <p className="-mt-2 text-xs text-[var(--danger-ink)]">{problem}</p>}

    <Button tone="secondary" busy={busy} disabled={disabled || !current || !next || Boolean(problem)}
      onClick={async () => {
        if (await onSave(current, next)) { setCurrent(""); setNext(""); }
      }}>
      Change password
    </Button>
  </Card>;
}
