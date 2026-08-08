"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, IndianRupee, Settings2, Wallet } from "lucide-react";
import { Badge, Button, Card, EmptyState, Field, LinkButton, Notice, PageTitle, Spinner, Stat } from "@/components/ui/kit";
import { Modal } from "@/components/ui/modal";
import { formatMoney } from "@/lib/billing/constants";
import { formatDate } from "@/lib/time";
import { monthLabel, payrollTone, previousMonth, type PayrollStatus } from "@/lib/hr/payroll";

type Run = {
  _id: string; month: string; status: PayrollStatus; lopBasis: string;
  totals: { employees: number; gross: number; deductions: number; netPay: number; employerCost: number };
  skipped: Array<{ name?: string; employeeId?: string; reason: string }>;
  generatedBy?: { name: string } | null; generatedAt?: string;
  approvedBy?: { name: string } | null; approvedAt?: string;
  paidBy?: { name: string } | null; paymentDate?: string;
};

type Preview = {
  month: string;
  lopBasis: string;
  payslips: Array<{ snapshot: { name?: string }; netPay: number }>;
  skipped: Array<{ name: string; employeeId: string; reason: string }>;
  totals: Run["totals"];
  existingStatus: PayrollStatus | null;
  incomplete: boolean;
};

/**
 * Every month of payroll the company has run.
 *
 * A month is prepared, approved and paid, and each of those is a deliberate
 * step somebody takes rather than something that happens on a schedule. The
 * list is the record of which months have been through which.
 */
export default function PayrollPage() {
  const router = useRouter();
  const [runs, setRuns] = useState<Run[]>([]);
  const [mayRun, setMayRun] = useState(false);
  const [loading, setLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/hr/payroll");
    const json = await response.json() as { data?: { items: Run[]; mayRun: boolean } };
    setRuns(json.data?.items ?? []);
    setMayRun(Boolean(json.data?.mayRun));
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <Spinner label="Loading payroll…" />;

  const paidThisYear = runs.filter(run => run.status === "Paid")
    .reduce((total, run) => total + (run.totals?.netPay ?? 0), 0);

  return <div className="space-y-5">
    <PageTitle title="Payroll" subtitle="One month at a time — prepared, approved, then paid"
      actions={<>
        <LinkButton tone="secondary" href="/admin/hr/payroll/settings"><Settings2 size={16} />Settings</LinkButton>
        {mayRun && <Button onClick={() => setPreparing(true)}><Wallet size={16} />Prepare a month</Button>}
      </>} />

    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

    {runs.length > 0 && (
      <Card className="grid grid-cols-2 gap-5 p-5 lg:grid-cols-4">
        <Stat label="Months on record" value={runs.length} />
        <Stat label="Awaiting approval" value={runs.filter(run => run.status === "Draft").length} />
        <Stat label="Approved, not paid" value={runs.filter(run => run.status === "Approved").length} />
        <Stat label="Paid out" value={formatMoney(paidThisYear)} />
      </Card>
    )}

    {runs.length ? (
      <Card className="divide-y divide-[var(--line)]">
        {runs.map(run => (
          <Link key={run._id} href={`/admin/hr/payroll/${run._id}`}
            className="flex flex-wrap items-center gap-4 px-5 py-4 hover:bg-[var(--surface-2)]">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold">{monthLabel(run.month)}</p>
                <Badge tone={payrollTone(run.status)}>{run.status}</Badge>
                {run.skipped?.length > 0 && (
                  <Badge tone="warn">{run.skipped.length} left out</Badge>
                )}
              </div>
              <p className="mt-0.5 text-xs text-[var(--muted)]">
                {run.totals?.employees ?? 0} employee{run.totals?.employees === 1 ? "" : "s"}
                {run.status === "Paid" && run.paymentDate ? ` · paid ${formatDate(run.paymentDate)}` : ""}
                {run.status === "Approved" && run.approvedBy ? ` · approved by ${run.approvedBy.name}` : ""}
                {run.status === "Draft" && run.generatedBy ? ` · prepared by ${run.generatedBy.name}` : ""}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-sm font-semibold">{formatMoney(run.totals?.netPay ?? 0)}</p>
              <p className="text-xs text-[var(--muted)]">net · {formatMoney(run.totals?.employerCost ?? 0)} cost</p>
            </div>
          </Link>
        ))}
      </Card>
    ) : (
      <EmptyState icon={IndianRupee} title="No payroll has been run yet"
        description="Set each employee's salary on their profile, then prepare a month here."
        action={mayRun ? <Button onClick={() => setPreparing(true)}>Prepare a month</Button> : undefined} />
    )}

    {preparing && (
      <PrepareMonth
        onClose={() => setPreparing(false)}
        onDone={(id, month) => {
          setPreparing(false);
          setNotice({ tone: "success", text: `${monthLabel(month)} is ready for approval.` });
          load();
          router.push(`/admin/hr/payroll/${id}`);
        }} />
    )}
  </div>;
}

/**
 * Preparing a month, in two steps on purpose.
 *
 * The preview writes nothing and shows exactly what would be written: the total,
 * the headcount and — the part that matters — everybody the run cannot pay and
 * why. Committing to a month's payroll without having seen who was left out of
 * it is how somebody misses a salary.
 */
function PrepareMonth({ onClose, onDone }: { onClose: () => void; onDone: (id: string, month: string) => void }) {
  const [month, setMonth] = useState(previousMonth());
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function send(action: "preview" | "generate") {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/hr/payroll", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ month, action })
      });
      const json = await response.json() as { error?: string; data?: Preview & { _id?: string } };
      if (!response.ok || !json.data) throw new Error(json.error ?? "Could not prepare this month");
      if (action === "preview") setPreview(json.data);
      else onDone(String(json.data._id), month);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not prepare this month");
    } finally { setBusy(false); }
  }

  return <Modal title="Prepare a month" description="Nothing is written until you generate it" onClose={onClose}>
    <div className="space-y-4">
      <Field label="Month" hint="Payroll is ordinarily run once the month has ended.">
        <input type="month" value={month} className="input"
          onChange={event => { setMonth(event.target.value); setPreview(null); }} />
      </Field>

      {error && <Notice tone="error">{error}</Notice>}

      {preview && <>
        {preview.incomplete && (
          <Notice tone="error">
            This month has not ended. Attendance for the days still to come is not in, so these figures will change.
          </Notice>
        )}
        {preview.existingStatus && preview.existingStatus !== "Draft" && (
          <Notice tone="error">
            {monthLabel(month)} has already been {preview.existingStatus.toLowerCase()}. Reopen it before preparing it again.
          </Notice>
        )}
        {preview.existingStatus === "Draft" && (
          <Notice tone="info">A draft for {monthLabel(month)} already exists. Generating replaces it.</Notice>
        )}

        <Card className="grid grid-cols-2 gap-4 p-4">
          <Stat label="Employees" value={preview.totals.employees} />
          <Stat label="Net payable" value={formatMoney(preview.totals.netPay)} />
          <Stat label="Gross" value={formatMoney(preview.totals.gross)} />
          <Stat label="Cost to company" value={formatMoney(preview.totals.employerCost)} />
        </Card>

        {preview.skipped.length > 0 && (
          <div className="rounded-[10px] border border-[var(--warn-line)] bg-[var(--warn-bg)] p-3">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-[var(--warn-ink)]">
              <AlertTriangle size={15} />{preview.skipped.length} not being paid
            </p>
            <ul className="mt-1.5 space-y-1 text-xs text-[var(--warn-ink)]">
              {preview.skipped.map(person => (
                <li key={person.employeeId}>
                  <span className="font-medium">{person.name}</span> — {person.reason}
                </li>
              ))}
            </ul>
          </div>
        )}

        {!preview.totals.employees && (
          <Notice tone="error">Nobody can be paid for this month yet. Set a salary on their profile first.</Notice>
        )}
      </>}

      <div className="flex gap-2">
        <Button tone="secondary" className="flex-1" busy={busy && !preview} onClick={() => send("preview")}>
          {preview ? "Refresh" : "Work it out"}
        </Button>
        <Button className="flex-1" busy={busy}
          disabled={!preview || !preview.totals.employees || (Boolean(preview.existingStatus) && preview.existingStatus !== "Draft")}
          onClick={() => send("generate")}>
          Generate payslips
        </Button>
      </div>
    </div>
  </Modal>;
}
