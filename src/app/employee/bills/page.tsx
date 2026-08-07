"use client";

import { useCallback, useEffect, useState } from "react";
import { Receipt } from "lucide-react";
import { Card, EmptyState, Notice, PageTitle, Spinner, Stat } from "@/components/ui/kit";
import { InvoiceRow, invoiceLabel } from "@/components/billing/invoice-row";
import { formatMoney } from "@/lib/billing/constants";
import type { BillingSummary, InvoiceListRow } from "@/lib/billing/types";

const TABS = [
  { key: "owed", label: "To collect" },
  { key: "all", label: "All bills" }
] as const;

/**
 * The rep's own bills. Money to collect comes first, because that is what the
 * screen is opened for — the full list is a tab away for looking something up.
 */
export default function MyBillsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("owed");
  const [rows, setRows] = useState<InvoiceListRow[]>([]);
  const [summary, setSummary] = useState<BillingSummary>({ billed: 0, collected: 0, outstanding: 0 });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: "100" });
    if (tab === "owed") params.set("due", "1");
    const response = await fetch(`/api/invoices?${params}`);
    const json = await response.json() as { data?: { items: InvoiceListRow[]; summary: BillingSummary } };
    setRows(json.data?.items ?? []);
    setSummary(json.data?.summary ?? { billed: 0, collected: 0, outstanding: 0 });
    setLoading(false);
  }, [tab]);
  useEffect(() => { load(); }, [load]);

  const overdue = rows.filter(row => invoiceLabel(row) === "Overdue");

  return <div className="space-y-4">
    <PageTitle title="My bills" subtitle="What your buyers owe, and when to ask for it" />

    {/* Two across on a phone: three rupee totals in 360px gave each column
        88px, and a five-figure bill needs more than that. */}
    <Card className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-3">
      <Stat label="Billed" value={formatMoney(summary.billed)} />
      <Stat label="Collected" value={formatMoney(summary.collected)} tone="text-emerald-700" />
      <Stat label="To collect" value={formatMoney(summary.outstanding)}
        tone={summary.outstanding > 0 ? "text-amber-700" : undefined} />
    </Card>

    {overdue.length > 0 && (
      <Notice tone="error">
        {overdue.length} bill{overdue.length === 1 ? "" : "s"} past the payment date — {formatMoney(
          overdue.reduce((total, row) => total + row.balanceDue, 0))} outstanding.
      </Notice>
    )}

    <div className="flex gap-1.5">
      {TABS.map(({ key, label }) => (
        <button key={key} onClick={() => setTab(key)}
          className={`inline-flex min-h-[38px] flex-1 items-center justify-center rounded-full border px-4 text-xs font-semibold ${
            tab === key ? "border-[var(--brand)] bg-[var(--brand)] text-white" : "border-[var(--line-2)] bg-white text-[var(--ink-2)]"
          }`}>{label}</button>
      ))}
    </div>

    {loading && <Spinner label="Loading your bills…" />}

    {!loading && !rows.length && (
      <EmptyState icon={Receipt}
        title={tab === "owed" ? "Nothing to collect" : "No bills yet"}
        description={tab === "owed"
          ? "Every bill in your name has been paid in full."
          : "Bills raised in your name appear here, with the amount due and the date to follow up."} />
    )}

    {!loading && rows.length > 0 && (
      <Card className="divide-y divide-[var(--line)]">
        {rows.map(row => <InvoiceRow key={row._id} row={row} href={`/employee/bills/${row._id}`} />)}
      </Card>
    )}

    {!loading && rows.length > 0 && (
      <p className="text-xs text-[var(--muted)]">
        Open a bill to record what the doctor has paid, or to download it as a PDF.
      </p>
    )}
  </div>;
}
