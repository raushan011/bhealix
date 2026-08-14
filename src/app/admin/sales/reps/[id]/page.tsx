"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { use } from "react";
import { ArrowLeft, Pencil, ShieldOff, UserCheck, UserX } from "lucide-react";
import { Badge, Button, Card, Notice, PageTitle, Spinner, Stat } from "@/components/ui/kit";
import { OrderList } from "@/components/sales/order-list";
import { RepForm } from "@/components/sales/rep-form";
import { formatDate } from "@/lib/time";
import { couponSetupOf, couponSetupTone, repStatusOf } from "@/lib/sales/partners";
import { formatRupees, type RepSummary, type SalesOrderRecord, type SalesRepRecord } from "@/lib/sales/types";

type Payload = { rep: SalesRepRecord; summary: RepSummary | null; orders: SalesOrderRecord[] };

/**
 * One rep: their codes, their orders and every rupee they have earned, split by
 * where it stands.
 *
 * The five earnings figures are the answer to the question a rep actually asks —
 * "how much am I getting and when" — so they are shown together rather than
 * rolled into one total that hides a parcel still in transit.
 */
export default function SalesRepPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(`/api/sales/reps/${id}`);
    const json = await response.json() as { data?: Payload };
    setData(json.data ?? null);
    setLoading(false);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function deactivate() {
    const response = await fetch(`/api/sales/reps/${id}`, { method: "DELETE" });
    const json = await response.json() as { error?: string; data?: { message?: string } };
    setNotice(json.data?.message ?? json.error ?? "Done.");
    load();
  }

  /**
   * Approving, turning down, suspending and putting back. Its own route, its own
   * audit line — see `api/sales/reps/[id]/approval`.
   */
  async function decide(action: "approve" | "reject" | "suspend" | "reinstate") {
    setDeciding(action);
    try {
      const response = await fetch(`/api/sales/reps/${id}/approval`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action })
      });
      const json = await response.json() as { error?: string; data?: { message?: string; shopProblems?: string[] } };
      const problems = json.data?.shopProblems ?? [];
      setNotice([
        json.data?.message ?? json.error ?? "Done.",
        // A code that could not be switched off in Shopify is still discounting
        // orders for somebody who has just been suspended. Said out loud.
        problems.length ? `Shopify would not switch these codes off: ${problems.join("; ")}. Switch them off by hand in the shop.` : ""
      ].filter(Boolean).join(" "));
      load();
    } finally { setDeciding(null); }
  }

  if (loading) return <Spinner label="Loading the rep…" />;
  if (!data) return <Notice tone="error">Could not load this rep.</Notice>;

  const { rep, summary, orders } = data;
  const earned = summary?.earned;
  const status = repStatusOf(rep);
  const unset = (rep.coupons ?? []).filter(coupon => couponSetupOf(coupon) !== "Live" && coupon.active);

  return <div className="space-y-5">
    <Link href="/admin/sales/reps" className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--ink)]">
      <ArrowLeft size={15} />Sales team
    </Link>

    <PageTitle title={rep.name} subtitle={`${rep.code} · ${rep.phone || rep.email || "no contact details"}`}
      actions={<>
        <Button tone="secondary" onClick={() => setEditing(true)}><Pencil size={16} />Edit</Button>
        {status === "Pending" && (
          <Button busy={deciding === "approve"} onClick={() => decide("approve")}><UserCheck size={16} />Approve</Button>
        )}
        {status === "Active" && rep.hasLogin && (
          <Button tone="danger" busy={deciding === "suspend"} onClick={() => decide("suspend")}>
            <ShieldOff size={16} />Suspend
          </Button>
        )}
        {(status === "Suspended" || status === "Rejected") && (
          <Button busy={deciding === "reinstate"} onClick={() => decide("reinstate")}><UserCheck size={16} />Reinstate</Button>
        )}
        {rep.active && status === "Active" && !rep.hasLogin && (
          <Button tone="danger" onClick={deactivate}><UserX size={16} />Deactivate</Button>
        )}
      </>} />

    {notice && <Notice tone="info">{notice}</Notice>}

    {status === "Pending" && (
      <Notice tone="warning">
        This person signed themselves up and is waiting for a decision. They can sign in and see that they are waiting;
        they cannot create a coupon code or earn anything until you approve them.
      </Notice>
    )}
    {status === "Suspended" && <Notice tone="error">Suspended. They cannot sign in, and their codes have been switched off in the shop. Everything already earned is unaffected.</Notice>}
    {status === "Rejected" && <Notice tone="error">This application was turned down. They cannot sign in.</Notice>}
    {rep.active === false && status === "Active" && <Notice tone="warning">This rep is inactive. Their codes no longer attribute new orders, and what they have already earned is unaffected.</Notice>}

    {unset.length > 0 && (
      <Notice tone="error">
        {unset.map(coupon => coupon.code).join(", ")} {unset.length === 1 ? "does" : "do"} not exist in Shopify, so
        {unset.length === 1 ? " it is" : " they are"} refused at the checkout — while this rep can see
        {unset.length === 1 ? " it" : " them"} in their portal. Fix {unset.length === 1 ? "it" : "them"} on the{" "}
        <Link href="/admin/sales/coupons" className="font-semibold underline">coupons screen</Link>.
      </Notice>
    )}

    <Card className="p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Coupon codes</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {(rep.coupons ?? []).length
          ? rep.coupons.map(coupon => {
            const setup = couponSetupOf(coupon);
            return <span key={coupon.code} className="inline-flex items-center gap-1.5">
              <Badge tone={coupon.active ? "brand" : "neutral"}>{coupon.code}</Badge>
              {setup !== "Live" && <Badge tone={couponSetupTone(setup)}>{setup}</Badge>}
              {coupon.issuedBy === "Rep" && <span className="text-xs text-[var(--muted)]">their own</span>}
              {coupon.note && <span className="text-xs text-[var(--muted)]">{coupon.note}</span>}
              {!coupon.active && <span className="text-xs text-[var(--muted)]">withdrawn</span>}
            </span>;
          })
          : <span className="text-sm text-[var(--muted)]">None issued.</span>}
      </div>
      <p className="mt-3 text-xs text-[var(--muted)]">
        Paid by {rep.payMethod ?? "UPI"}
        {rep.upiId ? ` · ${rep.upiId}` : ""}
        {rep.bankName ? ` · ${rep.bankName} ••••${(rep.bankAccountNo ?? "").slice(-4)}` : ""}
        {rep.joinedAt ? ` · joined ${formatDate(rep.joinedAt)}` : ""}
      </p>
      {/*
        * Whether they can reach the portal at all, which is a different fact
        * from their standing. Every rep typed in before the portal existed has
        * no password, and there is no way to tell from the rest of the record.
        */}
      <p className="mt-1 text-xs text-[var(--muted)]">
        {rep.hasLogin
          ? <>Signs in at the partner portal{rep.lastLoginAt ? ` · last seen ${formatDate(rep.lastLoginAt)}` : " · never signed in"}</>
          : "No portal login. They can be sent to the partner sign-up to create one."}
        {rep.selfRegistered ? " · signed themselves up" : ""}
      </p>
      {rep.reviewNote && <p className="mt-1 wrap-break-word text-xs text-[var(--muted)]">Note to them: {rep.reviewNote}</p>}
    </Card>

    <Card className="grid grid-cols-2 gap-5 p-5 lg:grid-cols-4">
      <Stat label="Orders" value={summary?.orders ?? 0} />
      <Stat label="Delivered" value={summary?.delivered ?? 0} />
      <Stat label="Came back" value={summary?.returned ?? 0}
        tone={summary?.returned ? "text-[var(--danger-ink)]" : undefined} />
      <Stat label="Revenue" value={formatRupees(summary?.revenue ?? 0)} />
    </Card>

    <Card className="grid grid-cols-2 gap-5 p-5 lg:grid-cols-5">
      <Stat label="Awaiting delivery" value={formatRupees(earned?.Pending ?? 0)} />
      <Stat label="Maturing" value={formatRupees(earned?.Maturing ?? 0)} />
      <Stat label="Payable" value={formatRupees(earned?.Payable ?? 0)} tone="text-[var(--ok-ink)]" />
      <Stat label="On a run" value={formatRupees(earned?.["In payout"] ?? 0)} />
      <Stat label="Paid" value={formatRupees(earned?.Paid ?? 0)} />
    </Card>

    <div>
      <h2 className="mb-2 text-base font-semibold">Orders</h2>
      <OrderList orders={orders} mayOverride showRep={false} onChanged={load} />
    </div>

    {editing && <RepForm rep={rep} onClose={() => setEditing(false)}
      onSaved={message => { setEditing(false); setNotice(message); load(); }} />}
  </div>;
}
