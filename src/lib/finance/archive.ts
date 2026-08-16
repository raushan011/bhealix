import { EXTENSION_FOR } from "./files";
import { formatPeriod, shortPeriod } from "./period";
import { sourceOf, sourceTitle } from "./sources";
import { uniqueEntryName, type ZipEntry } from "./zip";

/**
 * How a month of vendor invoices is laid out inside the archive somebody
 * downloads.
 *
 * Written for the person who opens it, who is an accountant with thirty files
 * and a return to file — not for the application that produced it. That decides
 * everything here: a folder per vendor because that is how the reconciliation is
 * done, the month in every file name so a file dragged out of the folder is
 * still identifiable, and a manifest at the top so the totals can be checked
 * without opening thirty PDFs.
 *
 * Pure and free of Mongoose: it takes plain records, so the naming can be tested
 * without a database and the same functions can label a preview on screen.
 */

export type ArchivableDocument = {
  period: string;
  source: string;
  number?: string;
  documentDate?: Date | string;
  description?: string;
  amount?: number;
  taxAmount?: number;
  currency?: string;
  fileName: string;
  contentType: string;
  bytes: number;
  origin?: string;
  notes?: string;
  createdAt?: Date | string;
};

/**
 * What naming a file actually needs, which is rather less than the whole record.
 *
 * Narrowed on purpose: the route that serves one document reads six fields out
 * of MongoDB and should not have to project the other seven — nor pretend to
 * have them — just to work out what to call the download.
 */
export type NameableDocument = Pick<ArchivableDocument, "period" | "source" | "number" | "description" | "fileName" | "contentType">;

const extensionOf = (document: NameableDocument) => {
  const fromName = document.fileName.toLowerCase().split(".").pop();
  const known = Object.values(EXTENSION_FOR);
  return fromName && known.includes(fromName) ? fromName : EXTENSION_FOR[document.contentType] ?? "pdf";
};

/**
 * One document's place in the archive: `Shiprocket/2026-08 Wallet recharge —
 * SR-4471.pdf`.
 *
 * The vendor's own file name is deliberately *not* used. Shiprocket calls every
 * invoice `invoice.pdf`, Meta calls every receipt `Receipt.pdf`, and a folder of
 * those tells the person opening it nothing at all — worse, they collide, and
 * two files with one name is one file after extraction. What goes in the name is
 * what somebody would need to identify the document without opening it: when,
 * what it is, and the vendor's reference where there is one.
 */
export function entryNameFor(document: NameableDocument): string {
  const source = sourceOf(document.source);
  const parts = [document.period, source.label];
  if (document.number) parts.push(document.number);
  else if (document.description) parts.push(document.description.slice(0, 60));

  return `${source.vendor}/${parts.join(" — ")}.${extensionOf(document)}`;
}

/** What the downloaded file is called. `Bhealix vendor invoices — Aug 2026.zip`. */
export function archiveFileName(periods: readonly string[], vendor?: string): string {
  const scope = vendor ? `${vendor} ` : "";
  if (periods.length === 1) return `Bhealix ${scope}vendor invoices — ${shortPeriod(periods[0])}.zip`;
  if (!periods.length) return `Bhealix ${scope}vendor invoices.zip`;

  const ordered = [...periods].sort();
  return `Bhealix ${scope}vendor invoices — ${shortPeriod(ordered[0])} to ${shortPeriod(ordered[ordered.length - 1])}.zip`;
}

/** One CSV cell, quoted so a description with a comma in it stays one column. */
const cell = (value: unknown): string => {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const isoDay = (value: Date | string | undefined) =>
  value ? new Date(value).toISOString().slice(0, 10) : "";

/**
 * The index that goes in at the top of the archive.
 *
 * The single most useful thing in the download, and the reason to build the ZIP
 * here rather than let somebody select thirty files in a browser: the accountant
 * gets a sheet they can total, tie to the bank statement, and use to see at a
 * glance that the Meta line is missing — without opening a single PDF. The file
 * name column is what points each row back at its document.
 *
 * A BOM leads the file because this is opened in Excel nine times out of ten,
 * and Excel reads a UTF-8 CSV as Windows-1252 without one — which turns every
 * rupee sign and every em dash into mojibake.
 */
export function manifestCsv(rows: readonly (ArchivableDocument & { entryName: string })[]): Buffer {
  const header = [
    "Month", "Vendor", "Document", "Number", "Date",
    "Amount", "Tax", "Currency", "Description", "Source of file", "File", "Notes"
  ];

  const body = rows.map(row => {
    const source = sourceOf(row.source);
    return [
      formatPeriod(row.period), source.vendor, source.label, row.number ?? "", isoDay(row.documentDate),
      row.amount ?? "", row.taxAmount ?? "", row.currency ?? "INR", row.description ?? "",
      row.origin === "pulled" ? "Pulled automatically" : "Uploaded by hand", row.entryName, row.notes ?? ""
    ].map(cell).join(",");
  });

  return Buffer.from(`﻿${[header.map(cell).join(","), ...body].join("\r\n")}\r\n`, "utf8");
}

/**
 * The whole archive's entries, manifest first.
 *
 * `bytesOf` is passed in rather than the bytes being on the record, because the
 * caller reads them from MongoDB one document at a time — holding a month of
 * PDFs in one array *and* then again inside the ZIP builder would double the
 * peak memory for no reason.
 */
export function archiveEntries(
  documents: readonly ArchivableDocument[],
  bytesOf: (index: number) => Uint8Array
): ZipEntry[] {
  const taken = new Set<string>();
  const named = documents.map(document => ({ ...document, entryName: uniqueEntryName(entryNameFor(document), taken) }));

  return [
    { name: uniqueEntryName("Contents.csv", taken), data: manifestCsv(named) },
    ...named.map((document, index) => ({
      name: document.entryName,
      data: bytesOf(index),
      at: document.createdAt ? new Date(document.createdAt) : undefined
    }))
  ];
}

/** "Shiprocket — wallet recharge", for a row on screen. Re-exported so the vault imports one module. */
export { sourceTitle };
