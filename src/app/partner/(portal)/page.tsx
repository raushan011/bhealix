"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Clock, Copy, Hourglass, ShieldCheck, Tag } from "lucide-react";
import { Badge, Card, EmptyState, LinkButton, Notice, Spinner, Stat } from "@/components/ui/kit";
import { couponSetupOf, couponSetupTone, MAX_COUPONS_PER_REP } from "@/lib/sales/partners";
import { formatRupees, type PartnerOverview } from "@/lib/sales/types";

/**
 * The affiliate's home screen.
 *
 * Built around one question — *what am I owed and when* — so the five earnings
 * figures are shown separately rather than rolled into a single total. A total
 * would be a bigger, friendlier number that quietly includes money on a parcel
 * still in transit, and the first time one of those parcels came back the
 * portal would have lied.
 */
export default function PartnerHome() {
  const [data, setData] = useState<PartnerOverview | null>(null);
  const [loading, setLoading] = useState(true);
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
    } catch {
      // Clipboard access is refused on an insecure origin and in some in-app
      // browsers. The code is on screen either way, so this is not worth an
      // error message.
    }
  }

  if (loading) return <Spinner label="Loading your account…" />;
  if (!data) return <Notice tone="error">Could not load your account. Pull down to try again.</Notice>;

  const { profile, summary, refusal } = data;
  const live = profile.coupons.filter(coupon => coupon.active);

  /* Waiting to be approved: one screen, and nothing else on it. Showing an
   * empty orders list and a disabled coupon button to somebody who has not been
   * accepted yet reads as a broken app rather than a queue. */
  if (profile.status === "Pending") {
    return <div className="space-y-5">
      <div>
        <h1 className="text-[22px]">Hello, {profile.name.split(" ")[0]}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">Your code will be <strong className="text-[var(--ink-2)]">{profile.code}</strong></p>
      </div>

      <Card className="px-6 py-10 text-center">
        <Hourglass size={28} className="mx-auto text-[var(--warn-ink)]" />
        <h2 className="mt-3 text-[15px] font-semibold">Waiting to be approved</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-[var(--muted)]">
          Somebody at the company is checking your application. As soon as it is approved you can create your own
          coupon code here and start earning on every order it brings in.
        </p>
      </Card>

      <Card className="p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">While you wait</p>
        <ul className="mt-3 space-y-2.5 text-sm text-[var(--ink-2)]">
          <li className="flex gap-2.5"><Tag size={16} className="mt-0.5 shrink-0 text-[var(--muted)]" />Your coupon will start with <strong>{profile.code}</strong> — the rest says which offer it is for.</li>
          <li className="flex gap-2.5"><Clock size={16} className="mt-0.5 shrink-0 text-[var(--muted)]" />Commission clears {data.holdDays} days after a parcel is delivered, once the return window has closed.</li>
          <li className="flex gap-2.5"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-[var(--muted)]" />Add where you would like to be paid on your <Link href="/partner/profile" className="font-semibold text-[var(--brand)] hover:underline">profile</Link>.</li>
        </ul>
      </Card>
    </div>;
  }

  return <div className="space-y-5">
    <div>
      <h1 className="text-[22px]">Hello, {profile.name.split(" ")[0]}</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">
        {summary.orders} order{summary.orders === 1 ? "" : "s"} brought in · {formatRupees(summary.revenue)} of sales
      </p>
    </div>

    {refusal && <Notice tone="warning">{refusal}</Notice>}

    {/* Payable first and coloured, because it is the figure being looked for. */}
    <Card className="grid grid-cols-2 gap-5 p-5">
      <Stat label="Ready to be paid" value={formatRupees(summary.earned.Payable)} tone="text-[var(--ok-ink)]" />
      <Stat label="Already paid" value={formatRupees(summary.earned.Paid)} />
      <Stat label="Clearing" value={formatRupees(summary.earned.Maturing)} />
      <Stat label="Still on its way" value={formatRupees(summary.earned.Pending)} />
    </Card>

    {summary.earned["In payout"] > 0 && (
      <Notice tone="success">
        {formatRupees(summary.earned["In payout"])} is on the current payment run. The amount is fixed and will not change.
      </Notice>
    )}

    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-base font-semibold">Your codes</h2>
        {live.length > 0 && live.length < MAX_COUPONS_PER_REP && (
          <Link href="/partner/coupons" className="text-sm font-semibold text-[var(--brand)] hover:underline">Create another</Link>
        )}
      </div>

      {live.length ? (
        <Card className="divide-y divide-[var(--line)]">
          {live.map(coupon => {
            const setup = couponSetupOf(coupon);
            return <div key={coupon.code} className="flex flex-wrap items-center gap-3 px-5 py-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-mono text-sm font-bold tracking-wider">{coupon.code}</p>
                  {setup !== "Live" && <Badge tone={couponSetupTone(setup)}>{setup}</Badge>}
                </div>
                {coupon.note && <p className="mt-0.5 text-xs text-[var(--muted)]">{coupon.note}</p>}
              </div>
              <button onClick={() => copy(coupon.code)}
                className="tap inline-flex shrink-0 items-center gap-1.5 rounded-[10px] border border-[var(--line-2)] px-3 text-xs font-semibold text-[var(--ink-2)] hover:bg-[var(--surface-2)]">
                <Copy size={13} />{copied === coupon.code ? "Copied" : "Copy"}
              </button>
            </div>;
          })}
        </Card>
      ) : (
        <EmptyState icon={Tag} title="No coupon code yet"
          description="Create your own code, share it with your customers, and every order it brings in is credited to you."
          action={<LinkButton href="/partner/coupons"><Tag size={16} />Create my code</LinkButton>} />
      )}
    </section>

    {summary.orders > 0 && (
      <Link href="/partner/orders"
        className="card flex items-center justify-between px-5 py-4 hover:bg-[var(--surface-2)]">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Track your orders</p>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            {summary.delivered} delivered · {summary.inTransit} on the way
            {summary.returned ? ` · ${summary.returned} came back` : ""}
          </p>
        </div>
        <ArrowRight size={17} className="shrink-0 text-[var(--muted)]" />
      </Link>
    )}
  </div>;
}
