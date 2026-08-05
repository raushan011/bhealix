import type { DiscountType, InvoiceStatus } from "./constants";

/**
 * Invoice arithmetic as pure functions, so the totals on the admin's screen and
 * the totals the server stores come from the same code rather than from two
 * implementations that agree until they don't. Nothing here touches the
 * database, the request or the browser.
 */

/**
 * Rupees to two decimals, rounding halves up.
 *
 * The nudge matters: `1.005 * 100` is 100.49999999999999 in binary floating
 * point, so a plain `Math.round` would quietly bill a paisa less.
 */
export function money(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(value) * 100 + 1e-9)) / 100;
}

export type LineInput = {
  name: string;
  hsnCode?: string;
  unit?: string;
  quantity: number;
  rate: number;
  discountType: DiscountType;
  discountValue: number;
  gstRate: number;
};

export type ComputedLine = {
  gross: number;
  discount: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  taxAmount: number;
  total: number;
};

export type InvoiceOptions = {
  /** true for a tax invoice, false for a bill of supply — a bill of supply charges no GST. */
  taxed: boolean;
  /** Place of supply outside the seller's own state, so one IGST replaces CGST + SGST. */
  interState: boolean;
  /** Rates typed as the price the doctor pays, tax already inside it. */
  ratesIncludeTax: boolean;
};

/**
 * One line, priced.
 *
 * The discount comes off the gross before any tax is worked out — a discount
 * shown on the face of the invoice reduces the taxable value, it is not a
 * rebate handed over afterwards. When rates are tax-inclusive the discounted
 * figure is the total, so the taxable value is what remains once the tax
 * baked into it is taken back out.
 */
export function computeLine(line: LineInput, options: InvoiceOptions): ComputedLine {
  const quantity = Math.max(0, Number(line.quantity) || 0);
  const rate = Math.max(0, Number(line.rate) || 0);
  const gross = money(quantity * rate);

  const value = Math.max(0, Number(line.discountValue) || 0);
  const raw = line.discountType === "PERCENT" ? (gross * Math.min(value, 100)) / 100 : value;
  // A discount can wipe a line out but never turn it into a credit.
  const discount = money(Math.min(raw, gross));
  const net = money(gross - discount);

  const gstRate = options.taxed ? Math.max(0, Number(line.gstRate) || 0) : 0;
  const taxableValue = options.ratesIncludeTax ? money(net / (1 + gstRate / 100)) : net;
  const taxAmount = money((taxableValue * gstRate) / 100);

  // Halving CGST by subtraction rather than by rounding twice, so the two
  // halves always add back to the tax on the line — no stray paisa.
  const cgst = options.interState ? 0 : money(taxAmount / 2);
  const sgst = options.interState ? 0 : money(taxAmount - cgst);
  const igst = options.interState ? taxAmount : 0;

  return {
    gross, discount, taxableValue, cgst, sgst, igst, taxAmount,
    total: money(taxableValue + taxAmount)
  };
}

export type TaxSummaryRow = {
  hsnCode: string;
  gstRate: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
};

export type InvoiceTotals = {
  subtotal: number;
  totalDiscount: number;
  taxableValue: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
  taxTotal: number;
  /** Before rounding — kept so the round-off line on the invoice can be justified. */
  netTotal: number;
  roundOff: number;
  grandTotal: number;
  taxSummary: TaxSummaryRow[];
};

/** Every line priced, plus the totals and the rate-wise summary an invoice must print. */
export function computeInvoice(lines: LineInput[], options: InvoiceOptions):
  { lines: Array<LineInput & ComputedLine>; totals: InvoiceTotals } {
  const priced = lines.map(line => ({ ...line, ...computeLine(line, options) }));

  const sum = (pick: (line: ComputedLine) => number) => money(priced.reduce((total, line) => total + pick(line), 0));

  const taxableValue = sum(line => line.taxableValue);
  const cgstTotal = sum(line => line.cgst);
  const sgstTotal = sum(line => line.sgst);
  const igstTotal = sum(line => line.igst);
  const taxTotal = money(cgstTotal + sgstTotal + igstTotal);
  const netTotal = money(taxableValue + taxTotal);

  // Invoices are settled in whole rupees; the difference is shown, not hidden.
  const grandTotal = Math.round(netTotal);
  const roundOff = money(grandTotal - netTotal);

  const summary = new Map<string, TaxSummaryRow>();
  for (const line of priced) {
    const hsnCode = line.hsnCode?.trim() ?? "";
    const key = `${hsnCode}|${line.gstRate}`;
    const row = summary.get(key)
      ?? { hsnCode, gstRate: options.taxed ? line.gstRate : 0, taxableValue: 0, cgst: 0, sgst: 0, igst: 0 };
    row.taxableValue = money(row.taxableValue + line.taxableValue);
    row.cgst = money(row.cgst + line.cgst);
    row.sgst = money(row.sgst + line.sgst);
    row.igst = money(row.igst + line.igst);
    summary.set(key, row);
  }

  return {
    lines: priced,
    totals: {
      subtotal: sum(line => line.gross),
      totalDiscount: sum(line => line.discount),
      taxableValue, cgstTotal, sgstTotal, igstTotal, taxTotal,
      netTotal, roundOff, grandTotal,
      taxSummary: [...summary.values()].sort((a, b) => a.gstRate - b.gstRate || a.hsnCode.localeCompare(b.hsnCode))
    }
  };
}

/**
 * What is still owed. Payments are summed rather than stored as a running
 * balance so removing a wrongly entered receipt corrects the invoice by itself.
 */
export function balanceOf(grandTotal: number, payments: Array<{ amount: number }>): number {
  const paid = money(payments.reduce((total, payment) => total + (Number(payment.amount) || 0), 0));
  return money(grandTotal - paid);
}

export const amountPaidOf = (payments: Array<{ amount: number }>) =>
  money(payments.reduce((total, payment) => total + (Number(payment.amount) || 0), 0));

/**
 * Status follows the money, never the other way round. A cancelled invoice keeps
 * its number and its place in the books but is owed nothing.
 */
export function statusFor(grandTotal: number, amountPaid: number, cancelled: boolean): InvoiceStatus {
  if (cancelled) return "Cancelled";
  if (amountPaid <= 0) return "Unpaid";
  // Rounding on the last part-payment must not leave an invoice a paisa short of paid.
  return amountPaid + 0.005 >= grandTotal ? "Paid" : "Partially paid";
}

/** Money is due and the day has passed. Derived at read time, never stored. */
export function isOverdue(invoice: { status: InvoiceStatus; dueDate?: string | Date | null }, now = new Date()): boolean {
  if (invoice.status === "Paid" || invoice.status === "Cancelled" || !invoice.dueDate) return false;
  const due = new Date(invoice.dueDate);
  if (Number.isNaN(due.getTime())) return false;
  // Due "on the 30th" means the whole of the 30th, so compare end of day.
  return new Date(due.getFullYear(), due.getMonth(), due.getDate(), 23, 59, 59) < now;
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function underHundred(value: number): string {
  if (value < 20) return ONES[value];
  return [TENS[Math.floor(value / 10)], ONES[value % 10]].filter(Boolean).join(" ");
}

/** Indian grouping: crore, lakh, thousand, hundred — not million and billion. */
function inWords(value: number): string {
  if (value < 100) return underHundred(value);
  const groups: Array<[number, string]> = [[10000000, "Crore"], [100000, "Lakh"], [1000, "Thousand"], [100, "Hundred"]];
  for (const [size, label] of groups) {
    if (value >= size) {
      const head = Math.floor(value / size);
      const rest = value % size;
      return [inWords(head), label, rest ? inWords(rest) : ""].filter(Boolean).join(" ");
    }
  }
  return underHundred(value);
}

/** The words an invoice has to carry beside the figure. */
export function amountInWords(amount: number): string {
  const value = money(Math.abs(amount));
  const rupees = Math.floor(value);
  const paise = Math.round((value - rupees) * 100);
  const words = rupees ? inWords(rupees) : "Zero";
  const tail = paise ? ` and ${inWords(paise)} Paise` : "";
  return `${amount < 0 ? "Minus " : ""}Rupees ${words}${tail} Only`;
}
