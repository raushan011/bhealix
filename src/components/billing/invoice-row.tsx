import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/kit";
import { formatDate } from "@/lib/time";
import { formatMoney } from "@/lib/billing/constants";
import { isOverdue } from "@/lib/billing/gst";
import type { InvoiceListRow } from "@/lib/billing/types";

type Rowish = Pick<InvoiceListRow, "status" | "dueDate">;

/** A status colour means the same thing at the desk and on the rep's phone. */
export function invoiceTone(row: Rowish) {
  if (row.status === "Cancelled") return "neutral" as const;
  if (row.status === "Paid") return "success" as const;
  if (isOverdue(row)) return "danger" as const;
  return row.status === "Partially paid" ? "warn" as const : "info" as const;
}

/**
 * Overdue is not a stored status — it is an unpaid bill whose day has gone, so
 * it is worked out at read time and shown in place of the status it refines.
 */
export const invoiceLabel = (row: Rowish) => (isOverdue(row) ? "Overdue" : row.status);

/** One bill in a list, identical in both panels so the two never drift apart. */
export function InvoiceRow({ row, href }: { row: InvoiceListRow; href: string }) {
  const label = invoiceLabel(row);
  const owing = row.status !== "Paid" && row.status !== "Cancelled";

  return <Link href={href} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3.5 hover:bg-[var(--surface-2)] sm:px-5">
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <p className="truncate text-sm font-semibold">{row.billTo?.name ?? "Doctor"}</p>
        <Badge tone={invoiceTone(row)}>{label}</Badge>
        {!row.taxed && <Badge tone="neutral">No GST</Badge>}
      </div>
      <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
        {[
          row.invoiceNo, formatDate(row.invoiceDate),
          // A doctor is the common case and says nothing; a stockist or a
          // distributor is worth calling out at a glance.
          row.billTo?.type && row.billTo.type !== "Doctor" ? row.billTo.type : null,
          row.employee?.name, row.billTo?.city
        ].filter(Boolean).join(" · ")}
      </p>
      {owing && (row.dueDate || row.followUpDate) && (
        <p className={`mt-0.5 flex items-center gap-1 text-xs font-medium ${label === "Overdue" ? "text-[var(--danger-ink)]" : "text-[var(--muted)]"}`}>
          {label === "Overdue" && <AlertTriangle size={11} className="shrink-0" />}
          {[
            row.dueDate && `Payment due ${formatDate(row.dueDate)}`,
            row.followUpDate && `follow up ${formatDate(row.followUpDate)}`
          ].filter(Boolean).join(" · ")}
        </p>
      )}
    </div>
    <div className="shrink-0 text-right">
      <p className="text-sm font-semibold">{formatMoney(row.grandTotal)}</p>
      {row.balanceDue > 0 && row.status !== "Cancelled" && (
        <p className="text-xs text-[var(--muted)]">{formatMoney(row.balanceDue)} due</p>
      )}
    </div>
  </Link>;
}
