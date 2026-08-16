import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { storedBytes } from "@/lib/db/bytes";
import { VendorInvoice } from "@/models/Finance";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { contentDisposition } from "@/lib/http/content-disposition";
import { record } from "@/lib/audit";
import { entryNameFor } from "@/lib/finance/archive";
import { toVaultDocument } from "@/lib/finance/documents";
import { isSourceKey } from "@/lib/finance/sources";
import { safeEntryName } from "@/lib/finance/zip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One filed document: the file itself, a correction to what is written about it,
 * or its removal.
 *
 * All three sit behind `viewFinance`/`manageFinance` and therefore behind the
 * super administrator alone. This is the company's own purchase paper — the
 * evidence behind a GST claim — and there is no reading of it that belongs to
 * the desk that raises invoices on doctors.
 */

/**
 * The file.
 *
 * Served from here rather than by handing the browser a link to storage: the
 * bytes are in MongoDB, they are private, and the name they are saved under
 * should be the one the archive would have used — `2026-08 Wallet recharge —
 * SR-4471.pdf` rather than the `invoice.pdf` every vendor calls everything.
 *
 * `?download=1` switches the disposition to an attachment. Without it a PDF
 * opens in the browser's viewer, which is what somebody clicking a row wants;
 * with it the file is saved, which is what the download button wants. One route,
 * because they are the same bytes and differ only in what the browser is told
 * to do with them.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.viewFinance);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Invalid document reference");

    await connectDb();
    const document = await VendorInvoice.findById(id)
      .select("+data period source number description documentDate contentType fileName")
      .lean() as {
        data?: unknown; period: string; source: string; number?: string;
        description?: string; contentType: string; fileName: string;
      } | null;

    if (!document) return badRequest("That document is no longer in the vault", 404);

    // Unwrapped before it is measured — see lib/db/bytes for why the stored
    // value cannot be handed to Uint8Array directly.
    const bytes = storedBytes(document.data);
    if (!bytes.byteLength) return badRequest("That document was filed without a file", 404);

    const download = new URL(request.url).searchParams.get("download") === "1";
    // The archive's own naming, minus the vendor folder it would sit in.
    const name = safeEntryName(entryNameFor(document).split("/").pop() ?? document.fileName);

    return new Response(bytes, {
      headers: {
        "content-type": document.contentType,
        "content-length": String(bytes.byteLength),
        "content-disposition": contentDisposition(name, download ? "attachment" : "inline"),
        "cache-control": "private, max-age=3600"
      }
    });
  } catch (error) {
    return fail(error);
  }
}

/**
 * What is written about a document, corrected.
 *
 * The file is never replaced. A vendor invoice is evidence, and a record whose
 * bytes can be swapped while its number and amount stay put proves nothing —
 * the same reasoning that keeps a payment proof from being edited in place next
 * door. A wrong file is deleted and the right one filed, which leaves both lines
 * in the trail.
 *
 * `null` is meaningful on every optional field and means "clear it", which is
 * how a figure typed in error is removed rather than replaced with a zero that
 * would go on being added into the month's total.
 */
const patch = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
  source: z.string().refine(isSourceKey).optional(),
  number: z.string().trim().max(120).nullable().optional(),
  documentDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  description: z.string().trim().max(300).nullable().optional(),
  amount: z.number().min(0).max(1e11).nullable().optional(),
  taxAmount: z.number().min(0).max(1e11).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional()
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.manageFinance);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Invalid document reference");

    await connectDb();
    const input = patch.parse(await request.json());

    const set: Record<string, unknown> = {};
    const unset: Record<string, ""> = {};
    const assign = (field: string, value: unknown) => {
      if (value === undefined) return;
      if (value === null) unset[field] = "";
      else set[field] = value;
    };

    assign("period", input.period);
    assign("source", input.source);
    assign("number", input.number);
    assign("description", input.description);
    assign("amount", input.amount);
    assign("taxAmount", input.taxAmount);
    assign("notes", input.notes);
    // Midnight on the working clock, so a date typed as the 1st does not land on
    // the 31st of the month before for a server keeping UTC.
    assign("documentDate", input.documentDate ? new Date(`${input.documentDate}T00:00:00+05:30`) : input.documentDate);

    if (!Object.keys(set).length && !Object.keys(unset).length) return badRequest("Nothing to change");

    const updated = await VendorInvoice.findByIdAndUpdate(
      id,
      { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) },
      { new: true, runValidators: true }
    ).lean() as Parameters<typeof toVaultDocument>[0] | null;

    if (!updated) return badRequest("That document is no longer in the vault", 404);

    await record({
      actor: auth.session.userId,
      action: "finance.invoice.updated",
      entityType: "VendorInvoice",
      entityId: id,
      metadata: { changed: [...Object.keys(set), ...Object.keys(unset)], period: updated.period, source: updated.source }
    });

    return ok({ document: toVaultDocument(updated) });
  } catch (error) {
    return fail(error);
  }
}

/**
 * Removes a document.
 *
 * What it was is copied into the trail on the way out — the month, the source,
 * the number and the amount — because after this the record is gone and the
 * audit line is the only remaining evidence that a deduction was ever claimed
 * against it.
 */
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.manageFinance);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Invalid document reference");

    await connectDb();
    const removed = await VendorInvoice.findByIdAndDelete(id)
      .select("period source number amount fileName origin")
      .lean() as { period: string; source: string; number?: string; amount?: number; fileName: string; origin: string } | null;

    if (!removed) return badRequest("That document is no longer in the vault", 404);

    await record({
      actor: auth.session.userId,
      action: "finance.invoice.deleted",
      entityType: "VendorInvoice",
      entityId: id,
      metadata: {
        period: removed.period, source: removed.source, number: removed.number,
        amount: removed.amount, fileName: removed.fileName, origin: removed.origin
      }
    });

    return ok({ deleted: true });
  } catch (error) {
    return fail(error);
  }
}
