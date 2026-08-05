import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { connectDb } from "@/lib/db/mongoose";
import { Invoice } from "@/models/Invoice";
import { requireSession } from "@/lib/auth/guard";
import { can, usesFieldPanel, homeFor } from "@/constants/access";
import { OBJECT_ID } from "@/lib/api";
import { loadSettings } from "@/lib/billing/invoices";
import { InvoiceDocument } from "@/components/billing/invoice-document";
import { PrintButton } from "@/components/billing/print-button";
import type { InvoiceRecord } from "@/lib/billing/types";

export const dynamic = "force-dynamic";

/**
 * The bill on its own page, outside both panels, so one link serves the
 * administrator at a desk and the representative on a phone. Printing it saves
 * a PDF on every platform the app runs on, which is what "download the bill"
 * means in practice without shipping a PDF engine to do it.
 */
export default async function InvoicePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!OBJECT_ID.test(id)) notFound();

  const session = await requireSession();
  await connectDb();

  const [invoice, settings] = await Promise.all([
    Invoice.findById(id)
      .populate("employee", "name employeeId")
      .populate("payments.receivedBy", "name")
      .lean() as unknown as Promise<(InvoiceRecord & { employee?: { _id: unknown } | null }) | null>,
    loadSettings()
  ]);
  if (!invoice) notFound();

  // A representative may print their own bills; desk roles may print any.
  const owned = String(invoice.employee?._id ?? "") === session.userId;
  const allowed = usesFieldPanel(session.role) ? owned : can.viewAllBilling(session.role);
  if (!allowed) notFound();

  const record = JSON.parse(JSON.stringify(invoice)) as InvoiceRecord;

  return <div className="min-h-[100dvh] bg-neutral-100 py-4 print:bg-white print:py-0">
    <div className="no-print mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center justify-between gap-3 px-4">
      <Link href={usesFieldPanel(session.role) ? `/employee/bills/${id}` : `/admin/billing/${id}`}
        className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--brand)]">
        <ArrowLeft size={16} />Back to the bill
      </Link>
      <div className="flex gap-2">
        <Link href={homeFor(session.role)}
          className="inline-flex min-h-[44px] items-center rounded-[10px] border border-neutral-300 bg-white px-4 text-sm font-semibold">
          Home
        </Link>
        <PrintButton />
      </div>
    </div>

    <InvoiceDocument invoice={record} settings={settings} />

    <p className="no-print mx-auto mt-4 max-w-[210mm] px-4 text-center text-xs text-neutral-500">
      Choose “Save as PDF” as the printer to download this bill.
    </p>
  </div>;
}
