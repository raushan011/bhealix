"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Notice, Spinner } from "@/components/ui/kit";
import { BillForm } from "@/components/billing/bill-form";
import type { InvoiceRecord } from "@/lib/billing/types";

/**
 * Editing a bill already raised. The number, and its place in the series, are
 * kept — this corrects what the bill says, it does not issue a new one.
 */
export default function EditBillPage() {
  const id = String(useParams().id ?? "");
  const [invoice, setInvoice] = useState<InvoiceRecord | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/invoices/${id}`).then(r => r.json())
      .then((json: { error?: string; data?: { invoice: InvoiceRecord } }) => {
        if (json.error || !json.data) { setError(json.error ?? "This bill could not be found"); return; }
        setInvoice(json.data.invoice);
      });
  }, [id]);

  if (error) return <div className="space-y-4">
    <Link href={`/admin/billing/${id}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--brand)]">
      <ArrowLeft size={16} />Back to the bill
    </Link>
    <Notice tone="error">{error}</Notice>
  </div>;

  if (!invoice) return <Spinner label="Opening the bill…" />;

  // Money already received is what makes a bill hard to change: the totals
  // could fall below what has been paid. Those receipts come off first.
  if (invoice.payments.length > 0 || invoice.status === "Cancelled") {
    return <div className="space-y-4">
      <Link href={`/admin/billing/${id}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--brand)]">
        <ArrowLeft size={16} />Back to the bill
      </Link>
      <Notice tone="error">
        {invoice.status === "Cancelled"
          ? "This bill has been cancelled, so it can no longer be changed."
          : "Money has been received against this bill. Remove the receipts on the bill first, then edit it."}
      </Notice>
    </div>;
  }

  return <BillForm invoice={invoice} />;
}
