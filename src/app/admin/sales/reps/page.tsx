"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { UserCheck, UserPlus, Users, UserX } from "lucide-react";
import { Badge, Button, Card, EmptyState, Field, Notice, PageTitle, Spinner, Stat } from "@/components/ui/kit";
import { RepForm } from "@/components/sales/rep-form";
import { formatDate } from "@/lib/time";
import { repStatusOf, repStatusTone } from "@/lib/sales/partners";
import { formatRupees, type RepSummary, type SalesRepRecord } from "@/lib/sales/types";

/**
 * The sales team, with what each of them has actually brought in.
 *
 * Sorted by what is payable rather than alphabetically: the list is read on
 * payout day, and the person owed the most is the one worth checking first.
 */
export default function SalesRepsPage() {
  const [reps, setReps] = useState<SalesRepRecord[]>([]);
  const [summaries, setSummaries] = useState<RepSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/sales/reps");
    const json = await response.json() as { data?: { reps: SalesRepRecord[]; summaries: RepSummary[] } };
    setReps(json.data?.reps ?? []);
    setSummaries(json.data?.summaries ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <Spinner label="Loading the sales team…" />;

  const byId = new Map(summaries.map(summary => [summary.rep._id, summary]));

  /*
   * Applications waiting on a decision come out of the list and go above it.
   *
   * They belong to a different task. The list below is read on payout day and is
   * sorted by what is owed; an unexamined stranger has no orders, no revenue and
   * would sit silently at the bottom of it — which is exactly how somebody waits
   * three weeks for an answer.
   */
  const waiting = reps.filter(rep => repStatusOf(rep) === "Pending")
    .sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")));
  const settled = reps.filter(rep => repStatusOf(rep) !== "Pending");

  const ordered = [...settled].sort((a, b) => {
    const left = byId.get(String(a._id)), right = byId.get(String(b._id));
    return (right?.payable ?? 0) - (left?.payable ?? 0) || (right?.revenue ?? 0) - (left?.revenue ?? 0);
  });

  const totals = summaries.reduce(
    (running, summary) => ({
      orders: running.orders + summary.orders,
      revenue: running.revenue + summary.revenue,
      payable: running.payable + summary.payable,
      paid: running.paid + summary.paid
    }),
    { orders: 0, revenue: 0, payable: 0, paid: 0 }
  );

  return <div className="space-y-5">
    <PageTitle title="Sales team" subtitle="Affiliates selling on commission, and what each has earned"
      actions={<Button onClick={() => setAdding(true)}><UserPlus size={16} />Add rep</Button>} />

    {notice && <Notice tone="success">{notice}</Notice>}

    {waiting.length > 0 && (
      <section>
        <h2 className="mb-2 text-base font-semibold">
          Waiting for a decision
          <span className="ml-2 rounded-full bg-[var(--warn-bg)] px-2 py-0.5 text-[11px] font-bold text-[var(--warn-ink)]">{waiting.length}</span>
        </h2>
        <p className="mb-2 text-xs text-[var(--muted)]">
          These people applied through the partner sign-up. They can sign in and see they are waiting; they cannot create
          a coupon code or earn anything until they are approved.
        </p>
        <Card className="divide-y divide-[var(--line)]">
          {waiting.map(rep => <PendingRep key={String(rep._id)} rep={rep}
            onDone={message => { setNotice(message); load(); }} />)}
        </Card>
      </section>
    )}

    {reps.length > 0 && (
      <Card className="grid grid-cols-2 gap-5 p-5 lg:grid-cols-4">
        <Stat label="Reps" value={reps.filter(rep => rep.active).length} />
        <Stat label="Orders brought in" value={totals.orders} />
        <Stat label="Revenue" value={formatRupees(totals.revenue)} />
        <Stat label="Payable now" value={formatRupees(totals.payable)} tone="text-[var(--ok-ink)]" />
      </Card>
    )}

    {ordered.length ? (
      <Card className="divide-y divide-[var(--line)]">
        {ordered.map(rep => {
          const summary = byId.get(String(rep._id));
          return <Link key={String(rep._id)} href={`/admin/sales/reps/${rep._id}`}
            className="flex flex-wrap items-center gap-4 px-5 py-4 hover:bg-[var(--surface-2)]">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold">{rep.name}</p>
                <Badge>{rep.code}</Badge>
                {/* The account and the attribution switch are different things,
                    so they get different badges rather than one that conflates
                    "we suspended them" with "their codes are off". */}
                {repStatusOf(rep) !== "Active" && (
                  <Badge tone={repStatusTone(repStatusOf(rep))}>{repStatusOf(rep)}</Badge>
                )}
                {rep.active === false && repStatusOf(rep) === "Active" && <Badge tone="warn">Inactive</Badge>}
                {rep.selfRegistered && <Badge tone="info">Signed up</Badge>}
              </div>
              <p className="mt-0.5 text-xs text-[var(--muted)]">
                {(rep.coupons ?? []).filter(coupon => coupon.active).map(coupon => coupon.code).join(" · ") || "No coupon codes"}
              </p>
              <p className="mt-0.5 text-xs text-[var(--muted)]">
                {summary?.orders ?? 0} order{summary?.orders === 1 ? "" : "s"} · {summary?.delivered ?? 0} delivered
                {summary?.returned ? ` · ${summary.returned} came back` : ""}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-sm font-semibold">{formatRupees(summary?.payable ?? 0)}</p>
              <p className="text-xs text-[var(--muted)]">payable · {formatRupees(summary?.paid ?? 0)} paid</p>
            </div>
          </Link>;
        })}
      </Card>
    ) : (
      <EmptyState icon={Users} title="No sales reps yet"
        description="A rep is added here with a code — RAUSHAN — and gets a coupon per commission rule. Create the matching discount codes in Shopify so orders can be attributed."
        action={<Button onClick={() => setAdding(true)}><UserPlus size={16} />Add the first rep</Button>} />
    )}

    {adding && <RepForm onClose={() => setAdding(false)} onSaved={message => { setAdding(false); setNotice(message); load(); }} />}
  </div>;
}

/**
 * One application, with the two answers to it.
 *
 * Approving is what turns a stranger into somebody who can mint a coupon code
 * and be paid a share of the orders it brings in, so the row shows everything
 * that decision needs — the name, how to reach them, the code they chose and
 * therefore what their coupons will look like — rather than making somebody open
 * a second screen to find out.
 *
 * Turning an application down asks for a reason, because the reason is shown to
 * the person. Approving does not: nobody needs to justify a yes, and a required
 * field there would only be filled in with a full stop.
 */
function PendingRep({ rep, onDone }: { rep: SalesRepRecord; onDone: (message: string) => void }) {
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  async function decide(action: "approve" | "reject") {
    setBusy(action); setError("");
    try {
      const response = await fetch(`/api/sales/reps/${rep._id}/approval`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, note: note || undefined })
      });
      const json = await response.json() as { error?: string; data?: { message?: string } };
      if (!response.ok) throw new Error(json.error ?? "Could not save that decision");
      onDone(json.data?.message ?? "Done.");
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not save that decision");
      setBusy(null);
    }
  }

  return <div className="px-5 py-4">
    <div className="flex flex-wrap items-start gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold">{rep.name}</p>
          <Badge tone="warn">Pending</Badge>
        </div>
        <p className="mt-0.5 wrap-break-word text-xs text-[var(--muted)]">
          {[rep.email, rep.phone].filter(Boolean).join(" · ") || "no contact details"}
        </p>
        <p className="mt-0.5 text-xs text-[var(--muted)]">
          Applied {rep.createdAt ? formatDate(rep.createdAt) : "recently"} · their coupons will start with <strong className="text-[var(--ink-2)]">{rep.code}</strong>
        </p>
      </div>

      <div className="flex shrink-0 gap-2">
        <Button tone="secondary" busy={busy === "reject"} onClick={() => setRejecting(current => !current)}>
          <UserX size={15} />Turn down
        </Button>
        <Button busy={busy === "approve"} onClick={() => decide("approve")}>
          <UserCheck size={15} />Approve
        </Button>
      </div>
    </div>

    {rejecting && (
      <div className="mt-3 space-y-2">
        <Field label="Why" hint="This is shown to them when they next sign in, so write it to be read.">
          <textarea className="textarea" rows={2} value={note} onChange={event => setNote(event.target.value)}
            placeholder="We are not taking on new partners in this area at the moment." />
        </Field>
        <Button tone="danger" busy={busy === "reject"} onClick={() => decide("reject")}>Turn down this application</Button>
      </div>
    )}

    {error && <p className="mt-2 text-xs text-[var(--danger-ink)]">{error}</p>}
  </div>;
}
