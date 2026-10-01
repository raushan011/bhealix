"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FilePlus2, FileText, Printer } from "lucide-react";
import { Badge, Card, EmptyState, LinkButton, Notice, PageTitle, Spinner, Stat } from "@/components/ui/kit";
import { formatMoney } from "@/lib/billing/constants";
import { formatDate } from "@/lib/time";
import type { CustomPayslipStatus } from "@/lib/hr/custom-payslip";

type Item = {
  _id: string; status: CustomPayslipStatus; title: string; periodLabel: string; month?: string;
  employeeName?: string; employee?: string | null;
  gross: number; totalDeductions: number; netPay: number;
  createdBy?: { name: string } | null; createdAt: string; updatedAt: string;
};

/**
 * Every payslip written by hand, newest first.
 *
 * Listed apart from the monthly runs on purpose: these are the sheets somebody
 * typed — arrears, settlements, bonuses, duplicates — and a reader must never
 * take one for a month the payroll worked out from attendance.
 */
export default function CustomPayslipsPage() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/hr/custom-payslips").then(response => response.json())
      .then((json: { error?: string; data?: { items: Item[] } }) => {
        if (!json.data) { setError(json.error ?? "Could not load the custom payslips"); return; }
        setItems(json.data.items);
      });
  }, []);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!items) return <Spinner label="Loading custom payslips…" />;

  const issued = items.filter(item => item.status === "Issued");

  return <div className="space-y-5">
    <Link href="/admin/hr/payroll" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--brand)]">
      <ArrowLeft size={16} />Payroll
    </Link>

    <PageTitle title="Custom payslips"
      subtitle="Written by hand, line by line — arrears, settlements, bonuses, duplicates, or any sheet the monthly run cannot make"
      actions={<LinkButton href="/admin/hr/payroll/custom/new"><FilePlus2 size={16} />New custom payslip</LinkButton>} />

    {items.length > 0 && (
      <Card className="grid grid-cols-2 gap-5 p-5 lg:grid-cols-4">
        <Stat label="Sheets" value={items.length} />
        <Stat label="Drafts" value={items.length - issued.length} />
        <Stat label="Issued" value={issued.length} />
        <Stat label="Issued, net" value={formatMoney(issued.reduce((sum, item) => sum + (item.netPay ?? 0), 0))} />
      </Card>
    )}

    {items.length ? (
      <Card className="divide-y divide-[var(--line)]">
        {items.map(item => (
          <div key={item._id} className="flex flex-wrap items-center gap-4 px-5 py-4">
            <Link href={`/admin/hr/payroll/custom/${item._id}`} className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold">{item.title}{item.periodLabel ? ` — ${item.periodLabel}` : ""}</p>
                <Badge tone={item.status === "Issued" ? "success" : "neutral"}>{item.status}</Badge>
              </div>
              <p className="mt-0.5 text-xs text-[var(--muted)]">
                {item.employeeName || "Not linked to an employee"}
                {item.createdBy ? ` · written by ${item.createdBy.name}` : ""}
                {` · ${formatDate(item.updatedAt)}`}
              </p>
            </Link>
            <div className="shrink-0 text-right">
              <p className="text-sm font-semibold tabular-nums">{formatMoney(item.netPay ?? 0)}</p>
              <p className="text-xs text-[var(--muted)]">net · {formatMoney(item.gross ?? 0)} gross</p>
            </div>
            <a href={`/payslips/custom/${item._id}/print`} target="_blank" rel="noreferrer"
              className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-[var(--brand)]" title="Print or save as PDF">
              <Printer size={13} />Print
            </a>
          </div>
        ))}
      </Card>
    ) : (
      <EmptyState icon={FileText} title="No custom payslip has been written yet"
        description="Write one for an arrear, a full-and-final settlement, a bonus, a duplicate, or anybody the monthly run does not cover."
        action={<LinkButton href="/admin/hr/payroll/custom/new"><FilePlus2 size={16} />New custom payslip</LinkButton>} />
    )}
  </div>;
}
