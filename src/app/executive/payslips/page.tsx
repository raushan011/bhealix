import Link from "next/link";
import { ChevronRight, Wallet } from "lucide-react";
import { requireExecutivePanel } from "@/lib/auth/guard";
import { connectDb } from "@/lib/db/mongoose";
import { Payslip } from "@/models/Payroll";
import { Badge, Card, EmptyState, PageTitle } from "@/components/ui/kit";
import { formatMoney } from "@/lib/billing/constants";
import { monthLabel, payrollTone, type PayrollStatus } from "@/lib/hr/payroll";

export const dynamic = "force-dynamic";

type Slip = { _id: unknown; month: string; status: PayrollStatus; netPay: number; gross: number; totalDeductions: number };

/**
 * The executive's own payslips, once each month has been approved — the same
 * rule the field panel follows, read straight from the payroll the HR desk ran.
 */
export default async function ExecutivePayslipsPage() {
  const session = await requireExecutivePanel();
  await connectDb();
  const payslips = await Payslip.find({ employee: session.userId, status: { $in: ["Approved", "Paid"] } })
    .sort({ month: -1 }).limit(24).lean() as unknown as Slip[];

  return <div className="space-y-4">
    <PageTitle title="My payslips" subtitle="Open one and choose “Save as PDF” to keep a copy" />
    {payslips.length ? (
      <Card className="divide-y divide-[var(--line)]">
        {payslips.map(slip => (
          <Link key={String(slip._id)} href={`/payslips/${slip._id}/print`} className="flex items-center gap-3 px-4 py-3.5 hover:bg-[var(--surface-2)]">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-semibold">{monthLabel(slip.month)}</p>
                <Badge tone={payrollTone(slip.status)}>{slip.status}</Badge>
              </div>
              <p className="mt-0.5 truncate text-xs text-[var(--muted)]">{formatMoney(slip.gross)} gross · {formatMoney(slip.totalDeductions)} deducted</p>
            </div>
            <span className="shrink-0 text-right"><span className="block text-sm font-semibold">{formatMoney(slip.netPay)}</span><span className="block text-[11px] text-[var(--muted)]">net</span></span>
            <ChevronRight size={16} className="shrink-0 text-[var(--muted)]" />
          </Link>
        ))}
      </Card>
    ) : (
      <EmptyState icon={Wallet} title="No payslips yet" description="A payslip appears here once the month has been approved by the office." />
    )}
  </div>;
}
