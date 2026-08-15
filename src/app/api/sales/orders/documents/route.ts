import { Types } from "mongoose";
import { connectDb } from "@/lib/db/mongoose";
import { SalesOrder } from "@/models/Sales";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, OBJECT_ID } from "@/lib/api";
import { documentFileName } from "@/lib/sales/fulfilment";
import { IntegrationError } from "@/lib/sales/http";
import { loadCredentials, shiprocketToken } from "@/lib/sales/settings";
import { documentUrl, fetchDocument } from "@/lib/sales/shiprocket";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Shiprocket renders thirty invoices into one PDF, then it has to be fetched. */
export const maxDuration = 60;

/** Thirty invoices is a morning's picking. Beyond that Shiprocket starts refusing the request. */
const MAX_DOCUMENTS = 30;

/**
 * The invoice or the shipping label, as one PDF.
 *
 * A list of orders rather than one, because that is how the paperwork is
 * actually used: the person packing the boxes prints the morning's invoices in
 * one go and puts one in each carton. Shiprocket merges them itself, so thirty
 * orders come back as a single thirty-page file rather than thirty downloads.
 *
 * The two documents key on different things and this is where getting it wrong
 * would be silent: an invoice belongs to the **order**, a label belongs to the
 * **shipment** — and a label needs an airway bill, so an order that has been
 * booked but not assigned has an invoice and no label. Both are checked here,
 * with a sentence naming which orders are not ready, rather than handing back an
 * empty PDF.
 *
 * The bytes are fetched server-side and streamed on. The URL Shiprocket answers
 * with carries an access signature and expires, and a file somebody downloads
 * should be named after their order rather than after a bucket key.
 */
export async function GET(request: Request) {
  try {
    const auth = await apiSession(can.processOrders);
    if ("response" in auth) return auth.response;
    await connectDb();

    const params = new URL(request.url).searchParams;
    const kind = params.get("doc") === "label" ? "label" : "invoice";
    const ids = (params.get("ids") ?? "").split(",").map(id => id.trim()).filter(id => OBJECT_ID.test(id));

    if (!ids.length) return badRequest("Choose at least one order.");
    if (ids.length > MAX_DOCUMENTS) return badRequest(`Shiprocket will print ${MAX_DOCUMENTS} at a time. Select fewer orders.`);

    const orders = await SalesOrder.find({ _id: { $in: ids.map(id => new Types.ObjectId(id)) } })
      .select("name shipment").sort({ placedAt: 1 })
      .lean() as { name?: string; shipment?: { shiprocketOrderId?: string; shipmentId?: string; awb?: string } }[];

    if (!orders.length) return badRequest("No such orders", 404);

    // Which of the chosen orders can actually produce this document, and the
    // names of the ones that cannot — so the refusal says *which* order to fix.
    const ready = orders.filter(order => kind === "invoice"
      ? order.shipment?.shiprocketOrderId
      : order.shipment?.shipmentId && order.shipment?.awb);

    if (!ready.length) {
      return badRequest(kind === "invoice"
        ? "None of these orders have been booked with Shiprocket yet, so there is no invoice to print."
        : "None of these orders have an airway bill yet. Process them first — a label is the airway bill.");
    }

    const settings = await loadCredentials();
    const token = await shiprocketToken(settings);
    if (!token) return badRequest("Shiprocket is not connected. Add the API user under Sales settings.", 502);

    try {
      const keys = ready.map(order => String(kind === "invoice" ? order.shipment?.shiprocketOrderId : order.shipment?.shipmentId));
      const bytes = await fetchDocument(await documentUrl(token, kind, keys));
      const names = ready.map(order => String(order.name ?? ""));

      return new Response(bytes as unknown as BodyInit, {
        headers: {
          "content-type": "application/pdf",
          "content-length": String(bytes.byteLength),
          "content-disposition": `attachment; filename="${documentFileName(kind, names)}"`,
          // Named on the response so the browser can say "3 of 5" when some of
          // the selection was not ready, without the file itself carrying it.
          "x-orders-included": String(ready.length),
          "x-orders-skipped": String(orders.length - ready.length),
          "cache-control": "private, no-store"
        }
      });
    } catch (error) {
      if (error instanceof IntegrationError) return badRequest(error.message, 502);
      throw error;
    }
  } catch (error) {
    return fail(error);
  }
}
