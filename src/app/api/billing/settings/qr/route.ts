import { connectDb } from "@/lib/db/mongoose";
import { BillingSettings } from "@/models/Settings";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok } from "@/lib/api";
import { record } from "@/lib/audit";
import { FILE_EXTENSION, MAX_QR_BYTES, QR_TYPES, sizeLimitText } from "@/lib/billing/attachments";

const ACCEPTED: readonly string[] = QR_TYPES;

/**
 * Serves the payment QR.
 *
 * Open to anybody signed in, not only the administrator who uploaded it: the
 * code is printed on every bill, and a representative saving a doctor's invoice
 * as a PDF on their phone is exactly who needs it to load.
 *
 * The bill asks for this URL with a `?v=` stamp taken from `paymentQrUpdatedAt`,
 * so the image can be cached hard and still change the moment it is replaced.
 */
export async function GET() {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;

    await connectDb();
    const settings = await BillingSettings.findOne({ key: "billing" })
      .select("+paymentQr paymentQrType paymentQrUpdatedAt").lean() as
      { paymentQr?: Buffer; paymentQrType?: string; paymentQrUpdatedAt?: Date } | null;

    if (!settings?.paymentQr?.length) return badRequest("No payment QR has been uploaded yet", 404);

    const bytes = new Uint8Array(settings.paymentQr);
    const type = settings.paymentQrType ?? "image/png";
    return new Response(bytes, {
      headers: {
        "content-type": type,
        "content-length": String(bytes.byteLength),
        "content-disposition": `inline; filename="payment-qr.${FILE_EXTENSION[type] ?? "png"}"`,
        "cache-control": "private, max-age=3600",
        etag: `"qr-${settings.paymentQrUpdatedAt?.getTime() ?? 0}"`
      }
    });
  } catch (error) {
    return fail(error);
  }
}

/**
 * Replaces the QR. There is only ever one, so an upload overwrites whatever was
 * there — a company that changes its UPI handle uploads the new code and the
 * next bill printed carries it.
 */
export async function POST(request: Request) {
  try {
    const auth = await apiSession(can.manageBilling);
    if ("response" in auth) return auth.response;
    await connectDb();

    const form = await request.formData();
    const file = form.get("qr");
    if (!file || typeof file !== "object" || typeof (file as File).arrayBuffer !== "function") {
      return badRequest("Choose the QR image to upload");
    }
    const image = file as File;
    if (!ACCEPTED.includes(image.type)) return badRequest("The QR must be a JPEG, PNG or WebP image");
    if (image.size > MAX_QR_BYTES) return badRequest(`The QR image must be ${sizeLimitText(MAX_QR_BYTES)}`);

    const data = Buffer.from(await image.arrayBuffer());
    if (!data.length) return badRequest("That file came through empty — try uploading it again");

    const updatedAt = new Date();
    const settings = await BillingSettings.findOneAndUpdate(
      { key: "billing" },
      {
        $set: { paymentQr: data, paymentQrType: image.type, paymentQrBytes: data.length, paymentQrUpdatedAt: updatedAt },
        $setOnInsert: { key: "billing" }
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).select("_id").lean() as { _id: unknown } | null;

    await record({
      actor: auth.session.userId, action: "billing.qr.updated",
      entityType: "BillingSettings", entityId: settings?._id, metadata: { bytes: data.length, contentType: image.type }
    });

    return ok({ paymentQrType: image.type, paymentQrBytes: data.length, paymentQrUpdatedAt: updatedAt }, 201);
  } catch (error) {
    return fail(error);
  }
}

/** Takes the QR off the bill again. The bank details beside it are untouched. */
export async function DELETE() {
  try {
    const auth = await apiSession(can.manageBilling);
    if ("response" in auth) return auth.response;
    await connectDb();

    const settings = await BillingSettings.findOneAndUpdate(
      { key: "billing" },
      { $unset: { paymentQr: "", paymentQrType: "", paymentQrBytes: "", paymentQrUpdatedAt: "" } }
    ).select("_id").lean() as { _id: unknown } | null;

    await record({
      actor: auth.session.userId, action: "billing.qr.removed",
      entityType: "BillingSettings", entityId: settings?._id
    });
    return ok({ removed: true });
  } catch (error) {
    return fail(error);
  }
}
