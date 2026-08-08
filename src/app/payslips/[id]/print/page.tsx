import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { connectDb } from "@/lib/db/mongoose";
import { PayrollRun, Payslip } from "@/models/Payroll";
import { requireSession } from "@/lib/auth/guard";
import { can, homeFor, usesFieldPanel } from "@/constants/access";
import { OBJECT_ID } from "@/lib/api";
import { loadSettings } from "@/lib/billing/invoices";
import { loadPayrollSettings } from "@/lib/hr/payroll-run";
import { PayslipDocument, type PayslipRecord } from "@/components/hr/payslip-document";
import { PrintButton } from "@/components/billing/print-button";

export const dynamic = "force-dynamic";

/**
 * A payslip on its own page, outside both panels, so one link serves the HR
 * desk and the representative on a phone. Printing it saves a PDF on every
 * platform the app runs on, which is what "download my payslip" means in
 * practice without shipping a PDF engine to do it.
 */
export default async function PayslipPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!OBJECT_ID.test(id)) notFound();

  const session = await requireSession();
  await connectDb();

  const payslip = await Payslip.findById(id).lean() as unknown as
    (PayslipRecord & { _id: unknown; employee: unknown; run: unknown }) | null;
  if (!payslip) notFound();

  /*
   * Everybody may print their own; only the HR desk may print anybody else's.
   * A draft is refused even to the person it concerns — until the month is
   * approved the figures are still being corrected, and a payslip handed to a
   * bank must not be one that is about to change.
   */
  const own = String(payslip.employee) === session.userId;
  const desk = can.viewPayroll(session.role);
  if (!own && !desk) notFound();
  if (payslip.status === "Draft" && !desk) notFound();

  const [company, payrollSettings, run] = await Promise.all([
    loadSettings(),
    loadPayrollSettings(),
    PayrollRun.findById(payslip.run).select("paymentDate paymentMode reference").lean() as
      Promise<{ paymentDate?: string; paymentMode?: string; reference?: string } | null>
  ]);

  const record = JSON.parse(JSON.stringify(payslip)) as PayslipRecord;
  const back = usesFieldPanel(session.role) ? "/employee/payslips" : `/admin/hr/payroll`;

  return <div className="min-h-[100dvh] bg-[var(--surface-2)] py-4 print:bg-white print:py-0">
    <div className="no-print mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center justify-between gap-3 px-4">
      <Link href={back} className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--brand)]">
        <ArrowLeft size={16} />Back
      </Link>
      <div className="flex gap-2">
        <Link href={homeFor(session.role)}
          className="inline-flex min-h-[44px] items-center rounded-[10px] border border-[var(--line-2)] bg-[var(--surface)] px-4 text-sm font-semibold">
          Home
        </Link>
        <PrintButton />
      </div>
    </div>

    <PayslipDocument payslip={record} company={company} meta={{
      paymentDate: run?.paymentDate,
      paymentMode: run?.paymentMode,
      reference: run?.reference,
      signatoryName: payrollSettings.signatoryName,
      note: payrollSettings.payslipNote
    }} />

    <p className="no-print mx-auto mt-4 max-w-[210mm] px-4 text-center text-xs text-[var(--muted)]">
      Choose “Save as PDF” as the printer to download this payslip.
    </p>
  </div>;
}
