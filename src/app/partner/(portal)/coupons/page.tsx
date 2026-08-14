"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Plus, Tag } from "lucide-react";
import { Badge, Button, Card, EmptyState, Field, Notice, PageTitle, Spinner } from "@/components/ui/kit";
import { Modal } from "@/components/ui/modal";
import { formatDate } from "@/lib/time";
import { normaliseCode } from "@/lib/sales/coupons";
import {
  couponSetupNote, couponSetupOf, couponSetupTone, generatedCode, generatedCodeProblem
} from "@/lib/sales/partners";
import type { PartnerOverview, PartnerRule } from "@/lib/sales/types";

/**
 * A rep's codes, and the button that makes a new one.
 *
 * The whole screen is built to answer "does this actually work yet". A code that
 * exists here but not in the shop is the failure that makes a rep believe they
 * are being cheated — the customer types it, the checkout refuses it, and the
 * portal is showing it in green. So every code carries its setup state, and one
 * that is not live says what that means in a sentence rather than in a colour.
 */
export default function PartnerCouponsPage() {
  const [data, setData] = useState<PartnerOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/partner/me");
    const json = await response.json() as { data?: PartnerOverview };
    setData(json.data ?? null);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      setTimeout(() => setCopied(""), 2000);
    } catch { /* Refused on an insecure origin; the code is on screen anyway. */ }
  }

  if (loading) return <Spinner label="Loading your codes…" />;
  if (!data) return <Notice tone="error">Could not load your codes.</Notice>;

  const { profile, rules, refusal, maxCoupons } = data;
  const held = profile.coupons.filter(coupon => coupon.active);
  const withdrawn = profile.coupons.filter(coupon => !coupon.active);
  const available = rules.filter(rule => !rule.held);
  const mayCreate = !refusal && available.length > 0 && held.length < maxCoupons;

  return <div className="space-y-5">
    <PageTitle title="My codes" subtitle={`Every code starts with ${profile.code}, so an order carrying one is unmistakably yours`}
      actions={mayCreate ? <Button onClick={() => setCreating(true)}><Plus size={16} />New code</Button> : undefined} />

    {notice && <Notice tone="success">{notice}</Notice>}
    {refusal && <Notice tone="warning">{refusal}</Notice>}

    {held.length ? (
      <Card className="divide-y divide-[var(--line)]">
        {held.map(coupon => {
          const setup = couponSetupOf(coupon);
          const note = couponSetupNote(setup);
          return <div key={coupon.code} className="px-5 py-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-mono text-base font-bold tracking-wider">{coupon.code}</p>
                  <Badge tone={couponSetupTone(setup)}>{setup === "Live" ? "Working" : setup}</Badge>
                </div>
                <p className="mt-0.5 text-xs text-[var(--muted)]">
                  {coupon.note ?? `Offer ${coupon.suffix}`}
                  {coupon.issuedAt ? ` · created ${formatDate(coupon.issuedAt)}` : ""}
                  {coupon.issuedBy === "Admin" ? " · issued by the company" : ""}
                </p>
              </div>
              <button onClick={() => copy(coupon.code)}
                className="tap inline-flex shrink-0 items-center gap-1.5 rounded-[10px] border border-[var(--line-2)] px-3 text-xs font-semibold text-[var(--ink-2)] hover:bg-[var(--surface-2)]">
                <Copy size={13} />{copied === coupon.code ? "Copied" : "Copy"}
              </button>
            </div>
            {note && <p className="mt-2 rounded-[8px] bg-[var(--warn-bg)] px-3 py-2 text-xs text-[var(--warn-ink)]">{note}</p>}
          </div>;
        })}
      </Card>
    ) : (
      <EmptyState icon={Tag} title="No codes yet"
        description={refusal ?? "Create your first code and start sharing it with your customers."}
        action={mayCreate ? <Button onClick={() => setCreating(true)}><Plus size={16} />Create my code</Button> : undefined} />
    )}

    {available.length === 0 && held.length > 0 && !refusal && (
      <Notice tone="info">You have a code for every offer the company is running. New offers appear here when they start.</Notice>
    )}

    {withdrawn.length > 0 && (
      <Card className="p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Withdrawn</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {withdrawn.map(coupon => <Badge key={coupon.code}>{coupon.code}</Badge>)}
        </div>
        <p className="mt-2 text-xs text-[var(--muted)]">
          These no longer work at the checkout. Orders they already brought in are still yours and are still paid.
        </p>
      </Card>
    )}

    {creating && <CreateCoupon repCode={profile.code} rules={available}
      onClose={() => setCreating(false)}
      onCreated={message => { setCreating(false); setNotice(message); load(); }} />}
  </div>;
}

/**
 * Picking an offer and, optionally, a word of one's own.
 *
 * The code is assembled live as they type, because the rule that makes this safe
 * — it has to start with their own rep code — is much easier to *see* than to
 * read. Validated with the same function the server validates with, so nothing
 * that will be refused survives the button.
 */
function CreateCoupon({ repCode, rules, onClose, onCreated }: {
  repCode: string;
  rules: PartnerRule[];
  onClose: () => void;
  onCreated: (message: string) => void;
}) {
  const [suffix, setSuffix] = useState(rules[0]?.suffix ?? "");
  const [word, setWord] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const rule = rules.find(candidate => candidate.suffix === suffix);
  const preview = rule ? generatedCode(repCode, rule.suffix, word) : "";
  const problem = rule && preview ? generatedCodeProblem(preview, repCode, rule.suffix) : null;

  async function create() {
    if (!rule) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/partner/coupons", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ suffix: rule.suffix, word: word || undefined })
      });
      const json = await response.json() as { error?: string; data?: { coupon?: { code: string }; usable?: boolean } };
      if (!response.ok) throw new Error(json.error ?? "Could not create the code");

      onCreated(json.data?.usable
        ? `${json.data.coupon?.code} is ready. Share it with your customers — it works at the checkout now.`
        : `${json.data?.coupon?.code} is reserved for you. The company has to finish setting it up before customers can use it.`);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not create the code");
    } finally { setBusy(false); }
  }

  return <Modal title="Create a coupon code" description="Choose which offer it is for. The company decides what customers get off; you decide what it is called."
    onClose={onClose}
    footer={<div className="flex gap-2">
      <Button tone="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
      <Button className="flex-1" busy={busy} disabled={!rule || Boolean(problem)} onClick={create}>Create it</Button>
    </div>}>

    <div className="space-y-4">
      <Field label="Which offer">
        <select className="select" value={suffix} onChange={event => setSuffix(event.target.value)}>
          {rules.map(candidate => (
            <option key={candidate.suffix} value={candidate.suffix}>
              {candidate.label} — you earn {candidate.rate}%
            </option>
          ))}
        </select>
      </Field>

      {rule && (
        <div className="rounded-[10px] border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-xs text-[var(--ink-2)]">
          {/* The two figures side by side and named, because they are different
              numbers and confusing them is expensive in both directions. */}
          <p>Your customer gets <strong>{rule.customerDiscount}</strong>.</p>
          <p className="mt-1">You earn <strong>{rule.rate}%</strong> on the lines your code applies to, once the order is delivered and the return window has closed.</p>
          {!rule.readyInShop && (
            <p className="mt-2 text-[var(--warn-ink)]">
              The company has not set what this offer takes off yet, so your code will be reserved for you but will not
              work at the checkout until they do.
            </p>
          )}
        </div>
      )}

      <Field label="Add a word of your own (optional)" hint="Letters only. Handy if you want a second code for a different audience.">
        <input className="input uppercase" placeholder="KIT" maxLength={12} autoCapitalize="characters" autoComplete="off"
          value={word} onChange={event => setWord(normaliseCode(event.target.value).replace(/[^A-Z]/g, ""))} />
      </Field>

      <div className="rounded-[10px] bg-[var(--brand-soft)] px-4 py-3 text-center">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">Your code will be</p>
        <p className="mt-1 font-mono text-lg font-bold tracking-wider text-[var(--brand)]">{preview || "—"}</p>
      </div>

      {problem && <Notice tone="error">{problem}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  </Modal>;
}
