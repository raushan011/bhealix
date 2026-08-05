/**
 * Invoice numbering. Pure so the format can be tested and shown in settings
 * without a database; the counter that makes a number unique lives in
 * `lib/billing/invoices.ts`, next to the collection it increments.
 */

/** India's books run April to March, and invoice series restart with them. */
export function financialYear(date: Date | string = new Date()): string {
  const value = typeof date === "string" ? new Date(date) : date;
  const year = value.getFullYear();
  // January to March still belong to the year that began the previous April.
  const startYear = value.getMonth() >= 3 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

export const DEFAULT_INVOICE_PREFIX = "BHX";

/** `BHX/2025-26/0001` — series, year, and a number that never repeats within it. */
export function formatInvoiceNo(prefix: string, year: string, sequence: number): string {
  const series = (prefix || DEFAULT_INVOICE_PREFIX).trim().toUpperCase().replace(/[^A-Z\d-]/g, "");
  return `${series || DEFAULT_INVOICE_PREFIX}/${year}/${String(sequence).padStart(4, "0")}`;
}

/** Due date from a credit period; a period of zero means payable on the spot. */
export function dueDateFrom(invoiceDate: string, days: number): string {
  const [year, month, day] = invoiceDate.split("-").map(Number);
  const date = new Date(year, month - 1, day + Math.max(0, Math.trunc(days || 0)));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
