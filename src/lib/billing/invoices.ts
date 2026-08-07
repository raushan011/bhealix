import { BillingSettings, Counter } from "@/models/Settings";
import { amountPaidOf, balanceOf, statusFor } from "./gst";
import { DEFAULT_INVOICE_PREFIX, financialYear, formatInvoiceNo } from "./numbering";

/** The seller's details as every invoice screen needs them. Server-side only. */
export type SellerSettings = {
  legalName: string; tradeName?: string; address?: string; city?: string;
  state?: string; stateCode?: string; pinCode?: string;
  gstin?: string; pan?: string; phone?: string; email?: string; website?: string;
  drugLicenceNo?: string;
  bankName?: string; bankAccountName?: string; bankAccountNo?: string; bankIfsc?: string;
  bankBranch?: string; upiId?: string;
  /**
   * The QR's description, never its bytes — `paymentQr` is `select: false`, so
   * a screen knows a code exists and when it changed without carrying it. The
   * timestamp doubles as the cache stamp on the URL that serves the image.
   */
  paymentQrType?: string; paymentQrBytes?: number; paymentQrUpdatedAt?: string | Date; paymentQrLabel?: string;
  invoicePrefix: string; defaultPaymentTerms: number; defaultGstRate: number;
  ratesIncludeTax: boolean; terms?: string; signatoryName?: string;
  showReceiverSignature?: boolean; receiverSignatureLabel?: string;
};

/**
 * The one settings document, created on first read so the billing screens have
 * something to edit rather than an empty state that has to be handled twice.
 */
export async function loadSettings(): Promise<SellerSettings & { _id?: unknown }> {
  const existing = await BillingSettings.findOneAndUpdate(
    { key: "billing" },
    { $setOnInsert: { key: "billing" } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean() as unknown as SellerSettings & { _id?: unknown };
  return existing;
}

/**
 * The next number in the series, claimed atomically.
 *
 * `$inc` inside `findOneAndUpdate` is a single database operation, so two
 * administrators pressing Save at the same instant get two different numbers —
 * a read-then-write would hand them both the same one and lose an invoice to a
 * duplicate-key error.
 */
export async function nextInvoiceNumber(prefix: string, date: Date): Promise<{ invoiceNo: string; year: string }> {
  const year = financialYear(date);
  const series = (prefix || DEFAULT_INVOICE_PREFIX).trim().toUpperCase();
  const counter = await Counter.findOneAndUpdate(
    { key: `invoice:${series}:${year}` },
    { $inc: { value: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean() as unknown as { value: number };

  return { invoiceNo: formatInvoiceNo(series, year, counter.value), year };
}

type Payable = {
  grandTotal: number;
  payments?: Array<{ amount: number }> | null;
  cancelledAt?: Date | null;
  amountPaid: number;
  balanceDue: number;
  status: string;
};

/**
 * Brings the cached money fields back in step with the receipts.
 *
 * `payments` is the record; `amountPaid`, `balanceDue` and `status` are a cache
 * of it so a list of a hundred invoices can be sorted by what is owed without
 * re-adding every receipt. Anything that touches a payment calls this.
 */
export function recalculate<T extends Payable>(invoice: T): T {
  const payments = invoice.payments ?? [];
  invoice.amountPaid = amountPaidOf(payments);
  invoice.balanceDue = balanceOf(invoice.grandTotal, payments);
  invoice.status = statusFor(invoice.grandTotal, invoice.amountPaid, Boolean(invoice.cancelledAt));
  return invoice;
}
