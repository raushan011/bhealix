/**
 * Reading a spreadsheet export.
 *
 * Written rather than pulled in, because the one thing a CSV parser has to get
 * right is the awkward middle: a quoted field containing a comma, a doubled
 * quote meaning a literal one, and a newline *inside* a quoted field. Splitting
 * on commas works on every file until the day an address has a comma in it, and
 * then it silently shifts every column one to the left — which here would mean
 * reading a discount as a total and paying somebody the wrong money.
 *
 * Pure and tested. No dependency, no framework.
 */

/** Rows of raw cells, exactly as the file has them. */
export function parseCsv(text: string): string[][] {
  // A byte-order mark on the first header would otherwise become part of its
  // name, and the column would never match.
  const input = text.replace(/^﻿/, "");

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let at = 0; at < input.length; at++) {
    const char = input[at];

    if (quoted) {
      if (char === '"') {
        // A doubled quote inside a quoted field is one literal quote.
        if (input[at + 1] === '"') { field += '"'; at++; }
        else quoted = false;
      } else field += char;
      continue;
    }

    if (char === '"') { quoted = true; continue; }
    if (char === ",") { row.push(field); field = ""; continue; }

    if (char === "\r") {
      // Swallow the \n of a \r\n; a lone \r still ends the row.
      if (input[at + 1] === "\n") at++;
      row.push(field); field = ""; rows.push(row); row = [];
      continue;
    }
    if (char === "\n") { row.push(field); field = ""; rows.push(row); row = []; continue; }

    field += char;
  }

  // Whatever is left is the last row, unless the file ended on a newline.
  if (field !== "" || row.length) { row.push(field); rows.push(row); }

  return rows.filter(entry => entry.some(cell => cell.trim() !== ""));
}

export type CsvTable = { headers: string[]; rows: Record<string, string>[] };

/**
 * The same file as named columns.
 *
 * Header names are kept as written for display, and matched case- and
 * space-insensitively elsewhere — exports vary between "Order ID", "order_id"
 * and "Order Id" for the same column and none of that is worth caring about.
 */
export function toTable(text: string): CsvTable {
  const [head, ...body] = parseCsv(text);
  if (!head) return { headers: [], rows: [] };

  const headers = head.map(cell => cell.trim());
  const rows = body.map(cells => {
    const row: Record<string, string> = {};
    headers.forEach((header, index) => { row[header] = (cells[index] ?? "").trim(); });
    return row;
  });

  return { headers, rows };
}

/** `"Order ID"` and `"order_id"` are the same column. */
export const normaliseHeader = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * A number out of a spreadsheet cell: `"₹ 1,499.00"`, `"1499"`, `"-59.90"`,
 * `""`. Anything unreadable is zero rather than NaN — a blank discount column
 * means no discount, not a broken import.
 */
export function amount(value: string | undefined): number {
  if (!value) return 0;
  const cleaned = value.replace(/[^\d.-]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * A date out of a spreadsheet cell.
 *
 * ISO first, then **day-before-month**, because these exports are Indian and
 * `03-08-2026` there means the third of August. Guessing the American order
 * would silently move a third of all orders into the wrong month, and the ones
 * it moves are exactly the ones nobody notices.
 */
export function parseDate(value: string | undefined): Date | null {
  const text = (value ?? "").trim();
  if (!text) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(text);
  if (iso) {
    const [, year, month, day, hour = "12", minute = "00", second = "00"] = iso;
    return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  }

  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[T ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(text);
  if (dmy) {
    const [, day, month, year, hour = "12", minute = "00", second = "00"] = dmy;
    if (Number(month) > 12) return null;
    return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
