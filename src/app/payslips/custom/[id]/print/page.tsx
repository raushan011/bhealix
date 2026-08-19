import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { connectDb } from "@/lib/db/mongoose";
import { CustomPayslip } from "@/models/Payroll";
import { requireSession } from "@/lib/auth/guard";
import { can, homeFor } from "@/constants/access";
import { OBJECT_ID } from "@/lib/api";
import { customToSheet, type CustomPayslipDoc } from "@/lib/hr/custom-payslip";
import { PayslipDocument } from "@/components/hr/payslip-document";
import { PrintButton } from "@/components/billing/print-button";

export const dynamic = "force-dynamic";

/**
 * A hand-written payslip on its own page, printed the same way as the monthly
 * one. The administrator may open any; the HR desk may read any, as with every
 * other payslip; the person it is linked to may open their own once it has been
 * issued — a draft is still being written and must not travel.
 */
export default async function CustomPayslipPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!OBJECT_ID.test(id)) notFound();

  const session = await requireSession();
  await connectDb();

  const found = await CustomPayslip.findById(id).lean() as unknown as (CustomPayslipDoc & { _id: unknown; employee?: unknown }) | null;
  if (!found) notFound();

  const own = found.employee ? String(found.employee) === session.userId : false;
  const desk = can.viewPayroll(session.role) || can.issueCustomPayslip(session.role);
  if (!own && !desk) notFound();
  if (found.status === "Draft" && !desk) notFound();

  const doc = JSON.parse(JSON.stringify(found)) as CustomPayslipDoc;
  const sheet = customToSheet(doc);
  const back = can.issueCustomPayslip(session.role) ? `/admin/hr/payroll/custom/${id}` : homeFor(session.role);

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

    <PayslipDocument payslip={sheet.payslip} company={sheet.company} meta={sheet.meta} custom={sheet.custom} />

    <p className="no-print mx-auto mt-4 max-w-[210mm] px-4 text-center text-xs text-[var(--muted)]">
      Choose “Save as PDF” as the printer to download this payslip.
    </p>
  </div>;
}
