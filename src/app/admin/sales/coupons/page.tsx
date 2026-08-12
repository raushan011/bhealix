"use client";

import { useCallback, useEffect, useState } from "react";
import { EyeOff, RefreshCw, Tag, UserPlus } from "lucide-react";
import { Badge, Button, Card, EmptyState, Field, Notice, PageTitle, Spinner, Stat } from "@/components/ui/kit";
import { Modal } from "@/components/ui/modal";
import { formatDate } from "@/lib/time";
import { PAYOUT_MODES } from "@/lib/sales/constants";
import { formatRupees } from "@/lib/sales/types";
import type { CatalogueEntry } from "@/lib/sales/catalogue";
import type { CommissionRule } from "@/lib/sales/commission";

type Rep = { _id: string; name: string; code: string };
type Payload = { coupons: CatalogueEntry[]; reps: Rep[]; rules: CommissionRule[]; refreshError?: string; mayManage: boolean };

/**
 * Every discount code in one place.
 *
 * The screen exists because a coupon is created in Shopify and has to be known
 * here before an order using it can be attributed. Until now that was two
 * systems and somebody's memory joining them, and a code that existed in one
 * and not the other was money going out with nobody credited.
 *
 * Unclaimed live codes sort to the top, because those are the ones costing
 * money right now.
 */
export default function SalesCouponsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [claiming, setClaiming] = useState<CatalogueEntry | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "warning" | "error"; text: string } | null>(null);

  const load = useCallback(async (refresh = false) => {
    const response = await fetch(`/api/sales/coupons${refresh ? "?refresh=1" : ""}`);
    const json = await response.json() as { data?: Payload };
    setData(json.data ?? null);
    if (json.data?.refreshError) setNotice({ tone: "warning", text: json.data.refreshError });
    setLoading(false);
    setRefreshing(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function mark(code: string, action: "ignore" | "unignore") {
    await fetch("/api/sales/coupons", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, code })
    });
    load();
  }

  if (loading) return <Spinner label="Loading coupon codes…" />;
  if (!data) return <Notice tone="error">Could not load the coupon codes.</Notice>;

  const unclaimed = data.coupons.filter(entry => !entry.rep && !entry.ignored && entry.live);
  const claimed = data.coupons.filter(entry => entry.rep);

  return <div className="space-y-5">
    <PageTitle title="Coupons" subtitle="Every discount code, and who is paid for it"
      actions={data.mayManage ? (
        <Button tone="secondary" busy={refreshing} onClick={() => { setRefreshing(true); load(true); }}>
          <RefreshCw size={16} />Refresh from Shopify
        </Button>
      ) : undefined} />

    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

    <Card className="grid grid-cols-2 gap-5 p-5 lg:grid-cols-4">
      <Stat label="Codes known" value={data.coupons.length} />
      <Stat label="Assigned to a rep" value={claimed.length} />
      <Stat label="Live and unclaimed" value={unclaimed.length}
        tone={unclaimed.length ? "text-[var(--warn-ink)]" : undefined} />
      <Stat label="Attributed orders" value={data.coupons.reduce((total, entry) => total + entry.orders, 0)} />
    </Card>

    {unclaimed.length > 0 && (
      <Notice tone="warning">
        {unclaimed.length} live code{unclaimed.length === 1 ? "" : "s"} belong{unclaimed.length === 1 ? "s" : ""} to no rep.
        Any order using {unclaimed.length === 1 ? "it" : "them"} earns nobody anything — assign {unclaimed.length === 1 ? "it" : "them"} below,
        or mark {unclaimed.length === 1 ? "it" : "them"} as not a rep&rsquo;s.
      </Notice>
    )}

    {data.coupons.length ? (
      <Card className="divide-y divide-[var(--line)]">
        {data.coupons.map(entry => (
          <div key={entry.code} className="flex flex-wrap items-start gap-4 px-5 py-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold">{entry.code}</p>
                {entry.rep
                  ? <Badge tone="success">{entry.rep.name}</Badge>
                  : entry.ignored
                    ? <Badge>Not a rep&rsquo;s</Badge>
                    : entry.live
                      ? <Badge tone="warn">Unassigned</Badge>
                      : <Badge>Unassigned</Badge>}
                {!entry.live && entry.status !== "Unknown" && <Badge>{entry.status.toLowerCase()}</Badge>}
              </div>

              <p className="mt-0.5 text-xs text-[var(--muted)]">
                {entry.summary ?? entry.title ?? "Seen on an order"}
                {entry.suffix ? ` · pays under rule ${entry.suffix}` : ""}
                {entry.usageCount != null ? ` · used ${entry.usageCount}× in Shopify` : ""}
                {entry.lastSeenAt ? ` · last seen ${formatDate(entry.lastSeenAt)}` : ""}
              </p>
            </div>

            <div className="shrink-0 text-right">
              <p className="text-sm font-semibold">{formatRupees(entry.revenue)}</p>
              <p className="text-xs text-[var(--muted)]">
                {entry.orders} attributed order{entry.orders === 1 ? "" : "s"}
              </p>

              {data.mayManage && !entry.rep && (
                <div className="mt-1 flex justify-end gap-3">
                  <button onClick={() => setClaiming(entry)}
                    className="inline-flex items-center gap-1 text-xs font-medium text-[var(--brand)] hover:underline">
                    <UserPlus size={12} />Assign
                  </button>
                  <button onClick={() => mark(entry.code, entry.ignored ? "unignore" : "ignore")}
                    className="inline-flex items-center gap-1 text-xs font-medium text-[var(--muted)] hover:underline">
                    <EyeOff size={12} />{entry.ignored ? "Undo" : "Not a rep&rsquo;s"}
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </Card>
    ) : (
      <EmptyState icon={Tag} title="No coupon codes yet"
        description="Codes appear here once Shopify is connected and a sync has run — from the shop's own discount list, and from any code seen on an order." />
    )}

    {claiming && (
      <ClaimCoupon entry={claiming} reps={data.reps} rules={data.rules}
        onClose={() => setClaiming(null)}
        onDone={message => { setClaiming(null); setNotice({ tone: "success", text: message }); load(); }} />
    )}
  </div>;
}

/**
 * Giving a code to somebody — an existing rep, or one created here and now.
 *
 * Creating the rep from this screen is the point: the moment you discover an
 * unclaimed code is the moment you know whose it is, and making somebody go to
 * another screen and type the code again is how it gets mistyped.
 */
function ClaimCoupon({ entry, reps, rules, onClose, onDone }: {
  entry: CatalogueEntry;
  reps: Rep[];
  rules: CommissionRule[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [mode, setMode] = useState<"existing" | "new">(reps.length ? "existing" : "new");
  const [rep, setRep] = useState(reps[0]?._id ?? "");
  const [suffix, setSuffix] = useState(rules[0]?.suffix ?? "");
  const [name, setName] = useState("");
  const [repCode, setRepCode] = useState("");
  const [phone, setPhone] = useState("");
  const [payMethod, setPayMethod] = useState<string>("UPI");
  const [upiId, setUpiId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/sales/coupons", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(mode === "existing"
          ? { action: "assign", code: entry.code, rep, suffix }
          : { action: "create-rep", code: entry.code, suffix, name, repCode, phone: phone || undefined, payMethod, upiId: upiId || undefined })
      });
      const json = await response.json() as { error?: string; data?: { rep?: { name: string } } };
      if (!response.ok) throw new Error(json.error ?? "Could not assign this code");

      onDone(`${entry.code} now belongs to ${json.data?.rep?.name ?? name}. Run a sync to attribute the orders it has already brought in.`);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not assign this code");
    } finally { setBusy(false); }
  }

  const valid = suffix && (mode === "existing" ? Boolean(rep) : name.trim().length >= 2 && repCode.trim().length >= 2);

  return <Modal title={`Assign ${entry.code}`}
    description={entry.summary ?? "Decide who is paid when this code is used"}
    onClose={onClose}
    footer={<div className="flex gap-2">
      <Button tone="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
      <Button className="flex-1" busy={busy} disabled={!valid} onClick={save}>
        {mode === "existing" ? "Assign" : "Create rep and assign"}
      </Button>
    </div>}>

    <div className="space-y-4">
      {entry.orders > 0 && (
        <Notice tone="info">
          {entry.orders} order{entry.orders === 1 ? "" : "s"} already carry this code. Assigning it does not backdate them
          on its own — run a Full resync afterwards and they will be attributed.
        </Notice>
      )}

      <Field label="Pays under">
        <select className="select" value={suffix} onChange={event => setSuffix(event.target.value)}>
          <option value="">Choose a rule…</option>
          {rules.map(rule => <option key={rule.suffix} value={rule.suffix}>{rule.label} — {rule.rate}%</option>)}
        </select>
      </Field>

      <div className="flex gap-2">
        <Button tone={mode === "existing" ? "primary" : "secondary"} className="flex-1"
          disabled={!reps.length} onClick={() => setMode("existing")}>Existing rep</Button>
        <Button tone={mode === "new" ? "primary" : "secondary"} className="flex-1"
          onClick={() => setMode("new")}>New rep</Button>
      </div>

      {mode === "existing" ? (
        <Field label="Rep">
          <select className="select" value={rep} onChange={event => setRep(event.target.value)}>
            {reps.map(entry => <option key={entry._id} value={entry._id}>{entry.name} ({entry.code})</option>)}
          </select>
        </Field>
      ) : <>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <input className="input" value={name} autoFocus onChange={event => setName(event.target.value)} placeholder="Shree Shathya" />
          </Field>
          <Field label="Rep code" hint="Their short code, not the coupon.">
            <input className="input" value={repCode} placeholder="SATHYA"
              onChange={event => setRepCode(event.target.value.toUpperCase())} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone"><input className="input" value={phone} onChange={event => setPhone(event.target.value)} /></Field>
          <Field label="Paid by">
            <select className="select" value={payMethod} onChange={event => setPayMethod(event.target.value)}>
              {PAYOUT_MODES.map(mode => <option key={mode} value={mode}>{mode}</option>)}
            </select>
          </Field>
        </div>
        {payMethod === "UPI" && (
          <Field label="UPI ID"><input className="input" value={upiId} onChange={event => setUpiId(event.target.value)} placeholder="name@bank" /></Field>
        )}
      </>}

      {error && <Notice tone="error">{error}</Notice>}
    </div>
  </Modal>;
}
