import Link from "next/link";
import { ArrowLeft, ChevronRight, Wallet } from "lucide-react";
import { requireFieldPanel } from "@/lib/auth/guard";
import { connectDb } from "@/lib/db/mongoose";
import { Payslip } from "@/models/Payroll";
import { Badge, Card, EmptyState, PageTitle } from "@/components/ui/kit";
import { formatMoney } from "@/lib/billing/constants";
import { monthLabel, payrollTone, type PayrollStatus } from "@/lib/hr/payroll";

export const dynamic = "force-dynamic";

type Slip = {
  _id: unknown; month: string; status: PayrollStatus;
  netPay: number; gross: number; totalDeductions: number;
  paidDays: number; divisorDays: number; lopDays: number;
};

/**
 * A rep's own payslips, on their phone.
 *
 * Only theirs, and only once the month has been approved — until then the
 * figures are still being corrected, and showing somebody a salary that then
 * changes starts a conversation nobody needs. Opening one prints it, which is
 * how a payslip becomes a PDF for a bank or a landlord.
 */
export default async function PayslipsPage() {
  const session = await requireFieldPanel();
  await connectDb();

  const payslips = await Payslip.find({
    employee: session.userId, status: { $in: ["Approved", "Paid"] }
  }).sort({ month: -1 }).limit(24).lean() as unknown as Slip[];

  const thisYear = payslips.filter(slip => slip.status === "Paid")
    .reduce((total, slip) => total + slip.netPay, 0);

  return <div className="space-y-4">
    <Link href="/employee/more" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--brand)]">
      <ArrowLeft size={15} />More
    </Link>

    <PageTitle title="My payslips" subtitle={payslips.length ? `${formatMoney(thisYear)} received in all` : undefined} />

    {payslips.length ? (
      <Card className="divide-y divide-[var(--line)]">
        {payslips.map(slip => (
          <Link key={String(slip._id)} href={`/payslips/${slip._id}/print`}
            className="flex items-center gap-3 px-4 py-3.5 active:bg-[var(--surface-2)]">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-semibold">{monthLabel(slip.month)}</p>
                <Badge tone={payrollTone(slip.status)}>{slip.status}</Badge>
              </div>
              <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
                {formatMoney(slip.gross)} gross · {formatMoney(slip.totalDeductions)} deducted
                {slip.lopDays > 0 ? ` · ${slip.paidDays} of ${slip.divisorDays} days paid` : ""}
              </p>
            </div>
            <span className="shrink-0 text-right">
              <span className="block text-sm font-semibold">{formatMoney(slip.netPay)}</span>
              <span className="block text-[11px] text-[var(--muted)]">net</span>
            </span>
            <ChevronRight size={16} className="shrink-0 text-[var(--muted)]" />
          </Link>
        ))}
      </Card>
    ) : (
      <EmptyState icon={Wallet} title="No payslips yet"
        description="A payslip appears here once the month has been approved by the office." />
    )}

    <p className="text-xs text-[var(--muted)]">
      Open a payslip and choose “Save as PDF” as the printer to keep a copy. Anything that looks wrong should go to the
      HR desk rather than being corrected here.
    </p>
  </div>;
}
