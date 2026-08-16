import { Types } from "mongoose";
import { connectDb } from "@/lib/db/mongoose";
import { storedBytes } from "@/lib/db/bytes";
import { Invoice } from "@/models/Invoice";
import { PaymentProof } from "@/models/PaymentProof";
import { apiSession } from "@/lib/auth/guard";
import { can, usesFieldPanel } from "@/constants/access";
import type { Session } from "@/lib/auth/session";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { contentDisposition } from "@/lib/http/content-disposition";
import { record } from "@/lib/audit";
import { FILE_EXTENSION, MAX_PROOF_BYTES, PROOF_TYPES, sizeLimitText } from "@/lib/billing/attachments";

const ACCEPTED: readonly string[] = PROOF_TYPES;

type Loaded = {
  invoice: { _id: unknown; invoiceNo: string; employee?: unknown };
  payment: { _id: unknown; amount: number; proof?: { uploadedBy?: unknown } | null };
};

/**
 * The invoice and the one receipt on it, with the ownership rule already
 * applied: a representative reaches their own bills and nobody else's, the desk
 * reaches any of them.
 */
async function load(id: string, paymentId: string, session: Session): Promise<Loaded | { error: Response }> {
  const invoice = await Invoice.findById(id).select("invoiceNo employee payments").lean() as
    (Loaded["invoice"] & { payments?: Array<Loaded["payment"]> }) | null;
  if (!invoice) return { error: badRequest("Invoice not found", 404) };

  const owner = String(invoice.employee ?? "") === session.userId;
  if (usesFieldPanel(session.role) ? !owner : !can.viewAllBilling(session.role)) {
    return { error: badRequest("You do not have access to this bill", 403) };
  }

  const payment = invoice.payments?.find(entry => String(entry._id) === paymentId);
  if (!payment) return { error: badRequest("That receipt is no longer on this bill", 404) };
  return { invoice, payment };
}

/**
 * Whether this person may attach or remove the file on this receipt.
 *
 * The rep who took the money attaches the screenshot, and may correct their own.
 * Swapping somebody else's proof is the administrator's alone — the same rule
 * the visit photographs follow, and for the same reason: evidence that anyone
 * can quietly replace proves nothing.
 */
function mayWrite(session: Session, invoice: Loaded["invoice"], payment: Loaded["payment"]) {
  if (can.manageBilling(session.role)) return true;
  if (!can.recordPayment(session.role)) return false;
  if (String(invoice.employee ?? "") !== session.userId) return false;
  const existing = payment.proof?.uploadedBy;
  return !existing || String(existing) === session.userId;
}

/** Serves the file itself. Private, and behind the same session as the bill. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string; paymentId: string }> }) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    const { id, paymentId } = await params;
    if (!OBJECT_ID.test(id) || !OBJECT_ID.test(paymentId)) return badRequest("Invalid payment reference");

    await connectDb();
    const found = await load(id, paymentId, auth.session);
    if ("error" in found) return found.error;

    const proof = await PaymentProof.findOne({ payment: paymentId, invoice: id })
      .select("+data contentType fileName").lean() as
      { data?: unknown; contentType: string; fileName?: string } | null;

    // Unwrapped before it is measured — see lib/db/bytes for why the stored
    // value cannot be handed to Uint8Array directly.
    const bytes = storedBytes(proof?.data);
    if (!proof || !bytes.byteLength) return badRequest("No proof is attached to this receipt", 404);

    const name = proof.fileName || `payment-proof.${FILE_EXTENSION[proof.contentType] ?? "jpg"}`;
    return new Response(bytes, {
      headers: {
        "content-type": proof.contentType,
        "content-length": String(bytes.byteLength),
        /*
         * Inline so a tap opens the screenshot rather than downloading it, and
         * the name is kept so a PDF saved from here is still recognisable.
         *
         * Through `contentDisposition` because this name came off a rep's phone.
         * A header value is a ByteString, and Node throws rather than mangling
         * anything when handed a character above 255 — so a receipt saved as
         * `भुगतान.pdf`, or with a rupee sign in it, would 500 on download rather
         * than arriving with a slightly wrong name.
         */
        "content-disposition": contentDisposition(name, "inline"),
        "cache-control": "private, max-age=3600"
      }
    });
  } catch (error) {
    return fail(error);
  }
}

/**
 * Attaches the proof of a receipt, or replaces one attached in error.
 *
 * The bytes go to their own collection and a description of them onto the
 * payment, so every screen that lists receipts can say whether the money has
 * been evidenced without reading a single image.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; paymentId: string }> }) {
  try {
    const auth = await apiSession(can.recordPayment);
    if ("response" in auth) return auth.response;
    const { id, paymentId } = await params;
    if (!OBJECT_ID.test(id) || !OBJECT_ID.test(paymentId)) return badRequest("Invalid payment reference");

    await connectDb();
    const found = await load(id, paymentId, auth.session);
    if ("error" in found) return found.error;
    if (!mayWrite(auth.session, found.invoice, found.payment)) {
      return badRequest("This proof was attached by someone else — only an administrator can replace it", 403);
    }

    const form = await request.formData();
    const file = form.get("proof");
    if (!file || typeof file !== "object" || typeof (file as File).arrayBuffer !== "function") {
      return badRequest("Choose the file that proves this payment");
    }
    const upload = file as File;
    if (!ACCEPTED.includes(upload.type)) return badRequest("Attach a JPEG, PNG or WebP image, or a PDF");
    if (upload.size > MAX_PROOF_BYTES) return badRequest(`The proof must be ${sizeLimitText(MAX_PROOF_BYTES)}`);

    const data = Buffer.from(await upload.arrayBuffer());
    if (!data.length) return badRequest("That file came through empty — try attaching it again");

    const fileName = upload.name?.trim().slice(0, 200) || undefined;
    /*
      Built as an ObjectId rather than left as the session's string. Mongoose
      casts a document it hydrates, but a positional `$set` of a whole nested
      subdocument goes to the driver as written — the id would be stored as
      text, and every later query comparing it against a real one would miss.
    */
    const uploader = new Types.ObjectId(auth.session.userId);
    const uploadedAt = new Date();
    const proof = {
      contentType: upload.type, bytes: data.length, fileName,
      uploadedAt, uploadedBy: uploader
    };

    // The bytes first: a description on the payment pointing at a file that was
    // never written would have every screen offering a proof that 404s.
    await PaymentProof.findOneAndUpdate(
      { payment: paymentId },
      { $set: { invoice: id, data, contentType: upload.type, bytes: data.length, fileName, uploadedBy: uploader } },
      { upsert: true, setDefaultsOnInsert: true }
    );
    await Invoice.updateOne(
      { _id: id, "payments._id": paymentId },
      { $set: { "payments.$.proof": proof } }
    );

    await record({
      actor: auth.session.userId,
      action: "invoice.payment.proof.added",
      entityType: "Invoice",
      entityId: found.invoice._id,
      metadata: { invoiceNo: found.invoice.invoiceNo, amount: found.payment.amount, bytes: data.length }
    });

    return ok({ proof }, 201);
  } catch (error) {
    return fail(error);
  }
}

/** Removes the file, leaving the receipt itself standing. */
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string; paymentId: string }> }) {
  try {
    const auth = await apiSession(can.recordPayment);
    if ("response" in auth) return auth.response;
    const { id, paymentId } = await params;
    if (!OBJECT_ID.test(id) || !OBJECT_ID.test(paymentId)) return badRequest("Invalid payment reference");

    await connectDb();
    const found = await load(id, paymentId, auth.session);
    if ("error" in found) return found.error;
    if (!found.payment.proof) return badRequest("No proof is attached to this receipt", 404);
    if (!mayWrite(auth.session, found.invoice, found.payment)) {
      return badRequest("This proof was attached by someone else — only an administrator can remove it", 403);
    }

    await PaymentProof.deleteOne({ payment: paymentId });
    await Invoice.updateOne({ _id: id, "payments._id": paymentId }, { $unset: { "payments.$.proof": "" } });

    await record({
      actor: auth.session.userId,
      action: "invoice.payment.proof.removed",
      entityType: "Invoice",
      entityId: found.invoice._id,
      metadata: { invoiceNo: found.invoice.invoiceNo, amount: found.payment.amount }
    });

    return ok({ removed: true });
  } catch (error) {
    return fail(error);
  }
}
