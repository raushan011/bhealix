import { Types } from "mongoose";
import { connectDb } from "@/lib/db/mongoose";
import { storedBytes } from "@/lib/db/bytes";
import { VendorInvoice } from "@/models/Finance";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, OBJECT_ID } from "@/lib/api";
import { contentDisposition } from "@/lib/http/content-disposition";
import { record } from "@/lib/audit";
import { archiveEntries, archiveFileName, type ArchivableDocument } from "@/lib/finance/archive";
import { vaultQuery } from "@/lib/finance/documents";
import { MAX_ARCHIVE_BYTES } from "@/lib/finance/files";
import { formatPeriod, isPeriod } from "@/lib/finance/period";
import { createZip } from "@/lib/finance/zip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** A year of scanned paper is a lot of bytes to read out of MongoDB and deflate. */
export const maxDuration = 120;

/**
 * A month — or a vendor within one, or a hand-picked few — as a single ZIP.
 *
 * The reason the whole feature was asked for. Before this, sending the
 * accountant a month meant opening four vendor dashboards, downloading from
 * each, remembering which of them had three separate invoices, and attaching
 * the lot to an email. This is one press, and what comes out is organised the
 * way the person opening it works: a folder per vendor, every file named with
 * its month and reference, and `Contents.csv` at the top listing the whole
 * bundle with its totals so it can be checked without opening a single PDF.
 *
 * Three ways to ask for one, all through the same query the list on screen uses,
 * so what downloads is always exactly what was on the table:
 *
 *   ?period=2026-08                    the month
 *   ?period=2026-08&vendor=Shiprocket  one supplier's part of it
 *   ?ids=a,b,c                         whatever was ticked
 */
export async function GET(request: Request) {
  try {
    const auth = await apiSession(can.viewFinance);
    if ("response" in auth) return auth.response;
    await connectDb();

    const params = new URL(request.url).searchParams;
    const ids = (params.get("ids") ?? "").split(",").map(id => id.trim()).filter(id => OBJECT_ID.test(id));
    const period = params.get("period");
    const vendor = params.get("vendor");

    if (!ids.length && !isPeriod(period)) return badRequest("Choose a month, or tick the invoices to include.");

    const query = ids.length
      ? { _id: { $in: ids.map(id => new Types.ObjectId(id)) } }
      : vaultQuery({ period, source: params.get("source"), vendor });

    /*
     * `+data` — the one place in the application that deliberately loads every
     * stored file at once. It is bounded twice over: by the month, and by the
     * running total below, which stops before the function's memory does and
     * says what it left out rather than being killed halfway through writing a
     * response the browser has already started saving.
     */
    const rows = await VendorInvoice.find(query)
      .select("+data period source number documentDate description amount taxAmount currency fileName contentType bytes origin notes createdAt")
      .sort({ period: 1, source: 1, documentDate: 1, createdAt: 1 })
      .lean() as unknown as (ArchivableDocument & { data?: unknown })[];

    if (!rows.length) {
      return badRequest(isPeriod(period)
        ? `Nothing has been filed for ${formatPeriod(period)} yet.`
        : "None of those invoices are in the vault any more.", 404);
    }

    const included: ArchivableDocument[] = [];
    const bytes: Uint8Array[] = [];
    let total = 0;
    let omitted = 0;

    for (const row of rows) {
      const file = storedBytes(row.data);
      // A row whose file never made it to the database is skipped rather than
      // written as a zero-byte entry somebody would take for a corrupt invoice.
      if (!file.byteLength) { omitted++; continue; }
      if (total + file.byteLength > MAX_ARCHIVE_BYTES) { omitted++; continue; }

      total += file.byteLength;
      included.push(row);
      bytes.push(file);
    }

    if (!included.length) return badRequest("Every document in that selection is too large to put in one archive. Download them one at a time.", 413);

    const archive = createZip(archiveEntries(included, index => bytes[index]));
    const periods = [...new Set(included.map(row => row.period))];
    const name = archiveFileName(periods, ids.length ? undefined : vendor ?? undefined);

    await record({
      actor: auth.session.userId,
      action: "finance.archive.downloaded",
      entityType: "FinancePeriod",
      entityId: periods.join(","),
      metadata: { documents: included.length, omitted, bytes: archive.length, vendor: vendor ?? undefined }
    });

    return new Response(archive as unknown as BodyInit, {
      headers: {
        "content-type": "application/zip",
        "content-length": String(archive.length),
        "content-disposition": contentDisposition(name),
        // Read by the screen so it can say "38 of 40 — two were too large",
        // without the archive itself having to carry the caveat.
        "x-documents-included": String(included.length),
        "x-documents-omitted": String(omitted),
        "cache-control": "private, no-store"
      }
    });
  } catch (error) {
    return fail(error);
  }
}
