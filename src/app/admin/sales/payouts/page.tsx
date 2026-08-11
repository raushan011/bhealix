"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BadgePercent, Wallet } from "lucide-react";
import { Badge, Button, Card, EmptyState, Field, Notice, PageTitle, Spinner, Stat } from "@/components/ui/kit";
import { Modal } from "@/components/ui/modal";
import { formatDate } from "@/lib/time";
import { payoutTone, periodLabel } from "@/lib/sales/payouts";
import { formatRupees, type PayoutRecord } from "@/lib/sales/types";

type Listing = {
  items: PayoutRecord[];
  proposed: { from: string; to: string };
  mayRun: boolean;
  mayApprove: boolean;
};

type PreviewLine = {
  rep: { _id: string; name: string; code: string; payMethod?: string; upiId?: string };
  orders: { _id: string; name?: string; amount: number }[];
  orderCount: number;
  gross: number;
};

type Preview = {
  period: { from: string; to: string };
  lines: PreviewLine[];
  totals: { reps: number; orders: number; gross: number; net: number };
  holdDays: number;
};

/**
 * Every payout run the company has made.
 *
 * A run is prepared, approved and paid — three deliberate steps, the same as
 * payroll — and this list is the record of which weeks have been through which.
 */
export default function SalesPayoutsPage() {
  const router = useRouter();
  const [data, setData] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/sales/payouts");
    const json = await response.json() as { data?: Listing };
    setData(json.data ?? null);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <Spinner label="Loading payouts…" />;
  if (!data) return <Notice tone="error">Could not load payouts.</Notice>;

  const runs = data.items;
  const paidOut = runs.filter(run => run.status === "Paid").reduce((total, run) => total + (run.totals?.net ?? 0), 0);

  return <div className="space-y-5">
    <PageTitle title="Payouts" subtitle="One week at a time — prepared, approved, then paid"
      actions={data.mayRun ? <Button onClick={() => setPreparing(true)}><Wallet size={16} />Prepare a payout</Button> : undefined} />

    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

    {runs.length > 0 && (
      <Card className="grid grid-cols-2 gap-5 p-5 lg:grid-cols-4">
        <Stat label="Runs on record" value={runs.length} />
        <Stat label="Awaiting approval" value={runs.filter(run => run.status === "Draft").length} />
        <Stat label="Approved, not paid" value={runs.filter(run => run.status === "Approved").length} />
        <Stat label="Paid out" value={formatRupees(paidOut)} />
      </Card>
    )}

    {runs.length ? (
      <Card className="divide-y divide-[var(--line)]">
        {runs.map(run => (
          <Link key={run._id} href={`/admin/sales/payouts/${run._id}`}
            className="flex flex-wrap items-center gap-4 px-5 py-4 hover:bg-[var(--surface-2)]">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold">{run.payoutNo}</p>
                <Badge tone={payoutTone(run.status)}>{run.status}</Badge>
              </div>
              <p className="mt-0.5 text-xs text-[var(--muted)]">
                {periodLabel({ from: run.from, to: run.to })} · {run.totals?.reps ?? 0} rep{run.totals?.reps === 1 ? "" : "s"} ·
                {" "}{run.totals?.orders ?? 0} order{run.totals?.orders === 1 ? "" : "s"}
                {run.status === "Paid" && run.paymentDate ? ` · paid ${formatDate(run.paymentDate)}` : ""}
              </p>
            </div>
            <p className="shrink-0 text-sm font-semibold">{formatRupees(run.totals?.net ?? 0)}</p>
          </Link>
        ))}
      </Card>
    ) : (
      <EmptyState icon={BadgePercent} title="No payouts yet"
        description="A run gathers every commission that has matured — delivered, and past the hold period — and sets it out per rep."
        action={data.mayRun ? <Button onClick={() => setPreparing(true)}>Prepare the first payout</Button> : undefined} />
    )}

    {preparing && (
      <PreparePayout proposed={data.proposed} onClose={() => setPreparing(false)}
        onDone={(id, payoutNo) => {
          setPreparing(false);
          setNotice({ tone: "success", text: `${payoutNo} is ready for approval.` });
          load();
          router.push(`/admin/sales/payouts/${id}`);
        }}
        onFailed={message => setNotice({ tone: "error", text: message })} />
    )}
  </div>;
}

/**
 * Preparing a run, in two steps.
 *
 * The preview writes nothing and shows exactly who would be paid what. Nobody
 * should commit a week's commissions without having seen the list — and unlike
 * payroll, the people on it are not on the payroll, so an error here is money
 * sent to somebody outside the company.
 */
function PreparePayout({ proposed, onClose, onDone, onFailed }: {
  proposed: { from: string; to: string };
  onClose: () => void;
  onDone: (id: string, payoutNo: string) => void;
  onFailed: (message: string) => void;
}) {
  const [period, setPeriod] = useState(proposed);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function send(action: "preview" | "generate") {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/sales/payouts", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...period })
      });
      const json = await response.json() as { error?: string; data?: Preview & { _id?: string; payoutNo?: string } };
      if (!response.ok || !json.data) throw new Error(json.error ?? "Could not prepare this payout");

      if (action === "preview") setPreview(json.data);
      else onDone(String(json.data._id), String(json.data.payoutNo));
    } catch (problem) {
      const message = problem instanceof Error ? problem.message : "Could not prepare this payout";
      if (action === "generate") { onFailed(message); onClose(); }
      else setError(message);
    } finally { setBusy(false); }
  }

  return <Modal title="Prepare a payout" description="Nothing is claimed until you generate it" onClose={onClose}
    footer={<div className="flex gap-2">
      <Button tone="secondary" className="flex-1" busy={busy && !preview} onClick={() => send("preview")}>
        {preview ? "Refresh" : "Work it out"}
      </Button>
      <Button className="flex-1" busy={busy} disabled={!preview || !preview.totals.reps} onClick={() => send("generate")}>
        Generate run
      </Button>
    </div>}>

    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="From">
          <input className="input" type="date" value={period.from}
            onChange={event => { setPeriod(current => ({ ...current, from: event.target.value })); setPreview(null); }} />
        </Field>
        <Field label="Closing on" hint="Everything matured by this day is swept in.">
          <input className="input" type="date" value={period.to}
            onChange={event => { setPeriod(current => ({ ...current, to: event.target.value })); setPreview(null); }} />
        </Field>
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      {preview && <>
        <Notice tone="info">
          Commissions clear {preview.holdDays} days after delivery. Anything that matured before this period and was never
          picked up is included too, so nothing is left stranded.
        </Notice>

        <Card className="grid grid-cols-3 gap-4 p-4">
          <Stat label="Reps" value={preview.totals.reps} />
          <Stat label="Orders" value={preview.totals.orders} />
          <Stat label="Total" value={formatRupees(preview.totals.gross)} />
        </Card>

        {preview.lines.length ? (
          <div className="divide-y divide-[var(--line)] rounded-[10px] border border-[var(--line)]">
            {preview.lines.map(line => (
              <div key={line.rep._id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{line.rep.name}</p>
                  <p className="text-xs text-[var(--muted)]">
                    {line.orderCount} order{line.orderCount === 1 ? "" : "s"}
                    {line.rep.payMethod === "UPI" && line.rep.upiId ? ` · ${line.rep.upiId}` : ` · ${line.rep.payMethod ?? "UPI"}`}
                  </p>
                </div>
                <p className="shrink-0 text-sm font-semibold tabular-nums">{formatRupees(line.gross)}</p>
              </div>
            ))}
          </div>
        ) : (
          <Notice tone="warning">
            Nothing has matured for this period. Commissions become payable {preview.holdDays} days after the parcel is
            delivered — check that a sync has run and that deliveries are coming through from Shiprocket.
          </Notice>
        )}
      </>}
    </div>
  </Modal>;
}
