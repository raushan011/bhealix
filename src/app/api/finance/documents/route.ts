import { Types } from "mongoose";
import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { VendorInvoice } from "@/models/Finance";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok } from "@/lib/api";
import { record } from "@/lib/audit";
import { listDocuments, periodsWithDocuments, summarise, toVaultDocument } from "@/lib/finance/documents";
import { MAX_VAULT_FILE_BYTES, resolveFileType, sizeLimitText } from "@/lib/finance/files";
import { currentPeriod, isPeriod, periodOf } from "@/lib/finance/period";
import { isSourceKey, sourceTitle } from "@/lib/finance/sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A month of the vault, in one request.
 *
 * The list, the checklist and the months to offer in the picker all arrive
 * together because the screen cannot usefully draw any of them alone — a table
 * with no "Meta: nothing filed" line beside it is the screen this feature exists
 * to replace. Three fetches for one view would also mean three moments at which
 * the summary and the rows below it could disagree.
 */
export async function GET(request: Request) {
  try {
    const auth = await apiSession(can.viewFinance);
    if ("response" in auth) return auth.response;
    await connectDb();

    const params = new URL(request.url).searchParams;
    const period = isPeriod(params.get("period")) ? params.get("period")! : currentPeriod();
    const source = params.get("source");
    const vendor = params.get("vendor");

    const [documents, summary, periods] = await Promise.all([
      listDocuments({ period, source, vendor }),
      summarise(period),
      periodsWithDocuments(currentPeriod())
    ]);

    return ok({ period, documents, summary, periods });
  } catch (error) {
    return fail(error);
  }
}

/**
 * The figures on the form, which arrive as text because the file beside them
 * forces `multipart/form-data`.
 *
 * Every one of them is optional, and that is a decision rather than laziness:
 * the file *is* the record, and a form that refuses an invoice until somebody
 * has read the tax figure off it is a form that ends with the invoice still
 * sitting in the Downloads folder. A figure can be added afterwards; a document
 * nobody filed cannot be.
 */
const schema = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Choose the month this bill belongs to"),
  source: z.string().refine(isSourceKey, "Choose what kind of bill this is"),
  number: z.string().trim().max(120).optional(),
  documentDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  description: z.string().trim().max(300).optional(),
  amount: z.coerce.number().min(0).max(1e11).optional(),
  taxAmount: z.coerce.number().min(0).max(1e11).optional(),
  notes: z.string().trim().max(500).optional()
});

const text = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

/**
 * Files a bill that arrived by hand.
 *
 * Which is most of them, and not for want of trying: of the seven sources this
 * vault tracks, one is on an API this account can reach and six are published
 * only in the vendor's own dashboard. So this route is not a fallback, it is the
 * main way the vault fills up, and it is built accordingly — the file is the only
 * required field, the month is chosen rather than inferred from the file's date,
 * and nothing is rejected for want of a figure.
 */
export async function POST(request: Request) {
  try {
    const auth = await apiSession(can.manageFinance);
    if ("response" in auth) return auth.response;
    await connectDb();

    const form = await request.formData();
    const file = form.get("file");
    if (!file || typeof file !== "object" || typeof (file as File).arrayBuffer !== "function") {
      return badRequest("Choose the invoice file to file.");
    }

    const upload = file as File;
    const fileName = upload.name?.trim().slice(0, 200) || "invoice";
    /*
     * The reported type is checked against the file's extension rather than
     * trusted outright. Windows reports a `.csv` as `application/vnd.ms-excel`
     * whenever Excel is installed, and a file dragged from a network share can
     * arrive with no type at all — refusing a perfectly good invoice over a
     * header nobody controls is the wrong failure.
     */
    const contentType = resolveFileType(upload.type, fileName);
    if (!contentType) return badRequest("File a PDF, an image, or a CSV or Excel export.");
    if (upload.size > MAX_VAULT_FILE_BYTES) return badRequest(`The file must be ${sizeLimitText(MAX_VAULT_FILE_BYTES)}.`);

    const input = schema.parse({
      period: text(form, "period") ?? "",
      source: text(form, "source") ?? "",
      number: text(form, "number"),
      documentDate: text(form, "documentDate"),
      description: text(form, "description"),
      amount: text(form, "amount"),
      taxAmount: text(form, "taxAmount"),
      notes: text(form, "notes")
    });

    const data = Buffer.from(await upload.arrayBuffer());
    if (!data.length) return badRequest("That file came through empty — try choosing it again.");

    const created = await VendorInvoice.create({
      period: input.period,
      source: input.source,
      number: input.number,
      documentDate: input.documentDate ? new Date(`${input.documentDate}T00:00:00+05:30`) : undefined,
      description: input.description,
      amount: input.amount,
      taxAmount: input.taxAmount,
      notes: input.notes,
      data,
      contentType,
      bytes: data.length,
      fileName,
      origin: "uploaded",
      uploadedBy: new Types.ObjectId(auth.session.userId)
    });

    await record({
      actor: auth.session.userId,
      action: "finance.invoice.filed",
      entityType: "VendorInvoice",
      entityId: created._id,
      metadata: { period: input.period, source: input.source, amount: input.amount, bytes: data.length, fileName }
    });

    /*
     * A note rather than a refusal when the printed date falls outside the month
     * it was filed against. It is very often correct — a Meta receipt dated the
     * 2nd of September is August's advertising, and a recharge made in March
     * pays for April — so this is a thing to be told, not stopped.
     */
    const drift = input.documentDate && periodOf(input.documentDate) !== input.period
      ? `Filed under ${input.period}, though the document is dated ${input.documentDate}. That is often right — change it on the row if it is not.`
      : undefined;

    return ok({
      document: toVaultDocument(created.toObject()),
      note: drift,
      message: `Filed under ${sourceTitle(input.source)}.`
    }, 201);
  } catch (error) {
    return fail(error);
  }
}
