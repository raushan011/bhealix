import { formatPeriod } from "./period";

/**
 * A month's transactions from a vendor's API, as a sheet the accountant can
 * total.
 *
 * The honest answer to a problem that has no better one. Razorpay, Shopify and
 * Meta each publish *the figures* on an API and *the tax invoice* only in their
 * dashboard — so a fetch can tell you exactly what you were charged and cannot
 * hand you the document you claim credit against. Building a statement out of
 * what the API does give is worth far more than refusing to fetch at all: it
 * ties to the bank statement, it says whether the PDF somebody eventually
 * uploads agrees with the transactions behind it, and it is the working the CA
 * asks for when a figure is queried.
 *
 * It is never presented as a tax invoice. The file says so in its first line,
 * the vault labels the row "statement", and the source card goes on asking for
 * the PDF.
 */

export type StatementColumn = { header: string; align?: "right" };

export type StatementTotals = {
  /** What the vendor charged in the month — the figure the CA is looking for. */
  amount?: number;
  /** The tax inside it, where the API breaks it out. */
  taxAmount?: number;
};

/** One CSV cell, quoted so a description with a comma stays one column. */
const cell = (value: unknown): string => {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/**
 * The sheet.
 *
 * A byte-order mark leads it because this is opened in Excel nine times out of
 * ten, and Excel reads a UTF-8 CSV as Windows-1252 without one — which turns
 * every rupee sign into mojibake. The preamble above the table is deliberate
 * too: a file that ends up detached from this application should still say what
 * it is, where it came from and what it is not.
 */
export function buildStatement({ vendor, period, columns, rows, totals, note }: {
  vendor: string;
  period: string;
  columns: readonly string[];
  rows: readonly (readonly unknown[])[];
  totals: StatementTotals;
  /** Anything the reader needs that the rows do not say. */
  note?: string;
}): Buffer {
  const preamble = [
    [`${vendor} — ${formatPeriod(period)}`],
    ["Built by BHEALIX CRM from the vendor's API. This is a statement of what was charged."],
    ["It is NOT a tax invoice. Claim input credit against the vendor's own PDF."],
    note ? [note] : null,
    []
  ].filter(Boolean) as unknown[][];

  const summary: unknown[][] = [
    [],
    ["Total charged", totals.amount ?? ""],
    ["Of which tax", totals.taxAmount ?? ""],
    ["Rows", rows.length]
  ];

  const body = [...preamble, [...columns], ...rows, ...summary]
    .map(row => row.map(cell).join(","))
    .join("\r\n");

  return Buffer.from(`﻿${body}\r\n`, "utf8");
}

/**
 * Paise to rupees, as every Indian payment API talks in the former and every
 * accountant in the latter. Two decimal places, because a fee is 2.36% of
 * something and rounding it here would stop the column adding up.
 */
export const fromPaise = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").trim());
  return Number.isFinite(parsed) ? Math.round(parsed) / 100 : 0;
};

/** Sums a column without letting floating point drift into the total. */
export const sumRupees = (values: readonly number[]): number =>
  Math.round(values.reduce((total, value) => total + value * 100, 0)) / 100;
