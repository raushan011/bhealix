"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { use } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Copy, KeyRound, Pencil, ShieldOff, Trash2, UserCheck, UserX } from "lucide-react";
import { Badge, Button, Card, Field, Notice, PageTitle, Spinner, Stat } from "@/components/ui/kit";
import { Modal } from "@/components/ui/modal";
import { OrderList } from "@/components/sales/order-list";
import { RepForm } from "@/components/sales/rep-form";
import { formatDate } from "@/lib/time";
import { normaliseCode } from "@/lib/sales/coupons";
import { couponSetupOf, couponSetupTone, repStatusOf } from "@/lib/sales/partners";
import { formatRupees, type RepSummary, type SalesOrderRecord, type SalesRepRecord } from "@/lib/sales/types";

type Payload = {
  rep: SalesRepRecord;
  summary: RepSummary | null;
  orders: SalesOrderRecord[];
  /** What a permanent delete would touch. Counted server-side, not from the capped order list. */
  attached?: { orders: number; paidOrders: number };
  mayPay?: boolean;
};

/**
 * One rep: their codes, their orders and every rupee they have earned, split by
 * where it stands.
 *
 * The four earnings figures are the answer to the question a rep actually asks —
 * "how much am I getting and when" — so they are shown together rather than
 * rolled into one total that hides a parcel still in transit.
 */
export default function SalesRepPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [deleting, setDeleting] = useState(false);
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

  if (loading) return <Spinner label="Loading the partner…" />;
  if (!data) return <Notice tone="error">Could not load this partner.</Notice>;

  const { rep, summary, orders } = data;
  const earned = summary?.earned;
  const status = repStatusOf(rep);
  const attached = data.attached ?? { orders: orders.length, paidOrders: 0 };
  const unset = (rep.coupons ?? []).filter(coupon => couponSetupOf(coupon) !== "Live" && coupon.active);

  return <div className="space-y-5">
    <Link href="/admin/sales/reps" className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--ink)]">
      <ArrowLeft size={15} />Sales partners
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
    {rep.active === false && status === "Active" && <Notice tone="warning">This partner is inactive. Their codes no longer attribute new orders, and what they have already earned is unaffected.</Notice>}

    {unset.length > 0 && (
      <Notice tone="error">
        {unset.map(coupon => coupon.code).join(", ")} {unset.length === 1 ? "does" : "do"} not exist in Shopify, so
        {unset.length === 1 ? " it is" : " they are"} refused at the checkout — while this partner can see
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
    </Card>

    {/*
      * Everything on record, unabbreviated.
      *
      * The bank account is shown in full here, where the payments list shows
      * only its last four. The two audiences are different: a list is glanced
      * at and left open, and this is the screen belonging to the
      * person who has to check the number before releasing money to it. A
      * masked account number they cannot verify is worse than useless.
      */}
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Partner details</p>
        <button onClick={() => setEditing(true)} className="text-xs font-semibold text-[var(--brand)] hover:underline">Edit</button>
      </div>

      <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <Detail label="Name" value={rep.name} />
        <Detail label="Partner code" value={rep.code} />
        <Detail label="Email" value={rep.email} />
        <Detail label="Phone" value={rep.phone} />
        <Detail label="Paid by" value={rep.payMethod ?? "UPI"} />
        {rep.payMethod === "Bank transfer" ? <>
          <Detail label="Account holder" value={rep.bankAccountName} />
          <Detail label="Bank" value={rep.bankName} />
          <Detail label="Account number" value={rep.bankAccountNo} />
          <Detail label="IFSC" value={rep.bankIfsc} />
        </> : <Detail label="UPI ID" value={rep.upiId} />}
        <Detail label="PAN" value={rep.panNumber} />
        <Detail label="Joined" value={rep.joinedAt ? formatDate(rep.joinedAt) : undefined} />
        <Detail label="Applied" value={rep.createdAt ? formatDate(rep.createdAt) : undefined} />
        <Detail label="Approved" value={rep.approvedAt ? formatDate(rep.approvedAt) : undefined} />
        <Detail label="How they joined" value={rep.selfRegistered ? "Signed themselves up" : "Entered by the office"} />
        <Detail label="Last signed in" value={rep.lastLoginAt ? formatDate(rep.lastLoginAt) : "Never"} />
      </dl>

      {rep.notes && <p className="mt-3 wrap-break-word text-xs text-[var(--muted)]">Internal note: {rep.notes}</p>}
      {rep.reviewNote && <p className="mt-1 wrap-break-word text-xs text-[var(--muted)]">Note shown to them: {rep.reviewNote}</p>}
    </Card>

    {/*
      * The portal login, and the one honest answer to "what is their password".
      *
      * Nothing here can show it: what is stored is a bcrypt hash, which is a
      * one-way function with no plaintext behind it to read. That is the whole
      * reason a copy of this database is not a set of usable accounts, and
      * people reuse passwords — the one on this screen would quite possibly
      * also open their email. So the answer is to set a new one and read it to
      * them, which is exactly what the staff reset next door does.
      */}
    <Card className="p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Portal login</p>
      <p className="mt-2 text-sm text-[var(--ink-2)]">
        {rep.hasLogin
          ? <>They sign in at <strong>/partner/login</strong> with <strong>{rep.email ?? "their email"}</strong> or the code <strong>{rep.code}</strong>.</>
          : <>This partner has no login yet, so they cannot open the portal at all. Give them a password to create one.</>}
      </p>
      <p className="mt-1 text-xs text-[var(--muted)]">
        Passwords are stored one-way and cannot be read back — not here and not by anybody. If they are locked out, set a
        new one and read it to them.
      </p>
      <div className="mt-3">
        <Button tone="secondary" onClick={() => setResetting(true)}>
          <KeyRound size={16} />{rep.hasLogin ? "Set a new password" : "Create their login"}
        </Button>
      </div>
    </Card>

    <Card className="grid grid-cols-2 gap-5 p-5 lg:grid-cols-4">
      <Stat label="Orders" value={summary?.orders ?? 0} />
      <Stat label="Delivered" value={summary?.delivered ?? 0} />
      <Stat label="Came back" value={summary?.returned ?? 0}
        tone={summary?.returned ? "text-[var(--danger-ink)]" : undefined} />
      <Stat label="Revenue" value={formatRupees(summary?.revenue ?? 0)} />
    </Card>

    <Card className="grid grid-cols-2 gap-5 p-5 lg:grid-cols-4">
      <Stat label="Awaiting delivery" value={formatRupees(earned?.Pending ?? 0)} />
      <Stat label="To pay now" value={formatRupees(earned?.Payable ?? 0)} tone={earned?.Payable ? "text-[var(--ok-ink)]" : undefined} />
      <Stat label="Paid" value={formatRupees(earned?.Paid ?? 0)} />
      <Stat label="Earned nothing" value={formatRupees(earned?.Void ?? 0)} />
    </Card>

    <div>
      <h2 className="mb-2 text-base font-semibold">Orders</h2>
      <OrderList orders={orders} mayOverride mayPay={data.mayPay ?? false} showRep={false} onChanged={load} />
    </div>

    {/*
      * Deleting sits at the bottom, on its own, away from everything somebody
      * came here to do. It is the only irreversible action on the screen.
      */}
    <Card className="p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--danger-ink)]">Delete this partner</p>
      <p className="mt-2 text-sm text-[var(--ink-2)]">
        Removes the record altogether. Their {attached.orders} order{attached.orders === 1 ? "" : "s"} keep their name and
        coupon code so the revenue still reads correctly, and any commission already paid is unchanged.
      </p>
      <div className="mt-3">
        <Button tone="danger" onClick={() => setDeleting(true)}><Trash2 size={16} />Delete permanently</Button>
      </div>
    </Card>

    {editing && <RepForm rep={rep} onClose={() => setEditing(false)}
      onSaved={message => { setEditing(false); setNotice(message); load(); }} />}

    {resetting && <ResetPassword rep={rep} onClose={() => setResetting(false)} onDone={load} />}

    {deleting && <DeletePartner rep={rep} attached={attached}
      onClose={() => setDeleting(false)}
      onDeleted={() => router.replace("/admin/sales/reps")} />}
  </div>;
}

/** One fact, with its name above it. `—` rather than a blank, so a missing value reads as missing. */
function Detail({ label, value }: { label: string; value?: string | null }) {
  return <div className="min-w-0">
    <dt className="text-[11px] uppercase tracking-wider text-[var(--muted)]">{label}</dt>
    <dd className="mt-0.5 wrap-break-word text-sm text-[var(--ink-2)]">{value || "—"}</dd>
  </div>;
}

/**
 * Giving a partner a password, shown once.
 *
 * The generated one is offered first and is the better habit: four short words
 * survive a bad phone line and a phone keyboard, where `xK7#pQ2!` produces a
 * second call. A password can be typed instead for the administrator who wants
 * to, and the server refuses anything too weak either way.
 *
 * Once the modal closes the password is gone for good — nothing stores it and
 * no screen can show it again. The copy button is there because the alternative
 * is somebody transcribing it wrongly.
 */
function ResetPassword({ rep, onClose, onDone }: {
  rep: SalesRepRecord;
  onClose: () => void;
  onDone: () => void;
}) {
  const [own, setOwn] = useState("");
  const [issued, setIssued] = useState<{ password: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  async function reset() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/sales/reps/${rep._id}/password`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(own ? { password: own } : {})
      });
      const json = await response.json() as { error?: string; data?: { password: string; message: string } };
      if (!response.ok || !json.data) throw new Error(json.error ?? "Could not set a password");
      setIssued(json.data);
      onDone();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not set a password");
    } finally { setBusy(false); }
  }

  if (issued) {
    return <Modal title="Password set" description="Read it to them now — this is the only time it is shown." onClose={onClose}
      footer={<Button className="w-full" onClick={onClose}>Done</Button>}>
      <div className="space-y-4">
        <div className="rounded-[10px] bg-[var(--brand-soft)] px-4 py-4 text-center">
          <p className="font-mono text-lg font-bold tracking-wide text-[var(--brand)]">{issued.password}</p>
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(issued.password);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              } catch { /* Refused on an insecure origin; it is on screen anyway. */ }
            }}
            className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--ink-2)] hover:underline">
            <Copy size={13} />{copied ? "Copied" : "Copy"}
          </button>
        </div>
        <Notice tone="success">{issued.message}</Notice>
        <p className="text-xs text-[var(--muted)]">
          Ask them to change it from their profile once they are in. Closing this box is the last you will see of it —
          if it is lost, set another.
        </p>
      </div>
    </Modal>;
  }

  return <Modal title={rep.hasLogin ? `New password for ${rep.name}` : `Create a login for ${rep.name}`}
    description="You will see it once, to read to them."
    onClose={onClose}
    footer={<div className="flex gap-2">
      <Button tone="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
      <Button className="flex-1" busy={busy} onClick={reset}>{own ? "Set this password" : "Generate a password"}</Button>
    </div>}>

    <div className="space-y-4">
      {rep.hasLogin && (
        <Notice tone="warning">
          This replaces their current password. They will be signed out of the portal everywhere the next time a screen
          asks the server anything.
        </Notice>
      )}
      <Field label="Password" hint="Leave it empty and a memorable one is generated — easier to read down a phone.">
        <input className="input" value={own} onChange={event => setOwn(event.target.value)} placeholder="Leave empty to generate one" />
      </Field>
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  </Modal>;
}

/**
 * Deleting the record, with the consequences said before the button rather
 * than discovered after it.
 *
 * The confirmation is the partner's own code, typed. A checkbox is clicked
 * without being read; retyping RAUSHAN cannot happen by accident. The server
 * checks it too, because a confirmation only the browser enforces is not one.
 */
function DeletePartner({ rep, attached, onClose, onDeleted }: {
  rep: SalesRepRecord;
  attached: { orders: number; paidOrders: number };
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const confirmed = normaliseCode(typed) === normaliseCode(rep.code);

  async function remove() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/sales/reps/${rep._id}?permanent=1&confirm=${encodeURIComponent(rep.code)}`, { method: "DELETE" });
      const json = await response.json() as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "Could not delete this partner");
      onDeleted();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not delete this partner");
      setBusy(false);
    }
  }

  return <Modal title={`Delete ${rep.name}`} description="This cannot be undone." onClose={onClose}
    footer={<div className="flex gap-2">
      <Button tone="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
      <Button tone="danger" className="flex-1" busy={busy} disabled={!confirmed} onClick={remove}>Delete permanently</Button>
    </div>}>

    <div className="space-y-4">
      <div className="space-y-1.5 text-sm text-[var(--ink-2)]">
        <p><strong>What goes:</strong> their record, their login, and their coupon codes.</p>
        <p>
          <strong>What stays:</strong> their {attached.orders} order{attached.orders === 1 ? "" : "s"}, which keep their
          name and coupon code so the revenue still reads correctly
          {attached.paidOrders > 0 && <> — including {attached.paidOrders} whose commission has been paid, which stay on the record as paid</>}.
        </p>
      </div>

      {/*
        * A live code left on the storefront is the one consequence nothing here
        * can clean up, because the record holding its Shopify id is about to be
        * removed. Suspending first does switch them off — so it is offered.
        */}
      {(rep.coupons ?? []).some(coupon => coupon.active) && (
        <Notice tone="warning">
          Their codes are <strong>not</strong> switched off in Shopify by this. Suspend them first if you want the
          discounts to stop working at the checkout, then delete.
        </Notice>
      )}

      <Field label={`Type ${rep.code} to confirm`}>
        <input className="input uppercase" value={typed} autoFocus autoComplete="off"
          onChange={event => setTyped(event.target.value)} placeholder={rep.code} />
      </Field>

      {error && <Notice tone="error">{error}</Notice>}
    </div>
  </Modal>;
}
