import { connectDb } from "@/lib/db/mongoose";
import { SalesTeamOrder } from "@/models/SalesTeam";
import { apiSession } from "@/lib/auth/guard";
import { badRequest, fail, OBJECT_ID } from "@/lib/api";
import { contentDisposition } from "@/lib/http/content-disposition";
import { documentFileName } from "@/lib/sales/fulfilment";
import { IntegrationError } from "@/lib/sales/http";
import { loadCredentials, shiprocketToken } from "@/lib/sales/settings";
import { documentUrl, fetchDocument } from "@/lib/sales/shiprocket";
import { orderScope } from "@/lib/sales-team/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The invoice or shipping label for one sales order, as a PDF.
 *
 * Streamed through rather than redirected, as on the affiliate side: the link
 * Shiprocket answers with is signed and expires. An invoice keys on the order
 * and a label on the shipment, and a label needs an airway bill first — both
 * are checked here so the refusal says what to do instead of handing back an
 * empty file.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    const scope = orderScope(auth.session);
    if (!scope) return badRequest("You do not have access to the sales team's orders", 403);
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Unknown order");
    await connectDb();

    const kind = new URL(request.url).searchParams.get("doc") === "label" ? "label" : "invoice";
    const order = await SalesTeamOrder.findOne({ _id: id, ...scope }).select("name shipment").lean() as
      { name: string; shipment?: { shiprocketOrderId?: string; shipmentId?: string; awb?: string } } | null;
    if (!order) return badRequest("That order could not be found", 404);

    const key = kind === "invoice" ? order.shipment?.shiprocketOrderId : order.shipment?.awb ? order.shipment?.shipmentId : undefined;
    if (!key) {
      return badRequest(kind === "invoice"
        ? "This order has not been booked with Shiprocket yet."
        : "A label needs an airway bill. Book the order with a courier first.");
    }

    const token = await shiprocketToken(await loadCredentials());
    if (!token) return badRequest("Shiprocket is not connected.", 502);

    try {
      const bytes = await fetchDocument(await documentUrl(token, kind, [key]));
      return new Response(Buffer.from(bytes), {
        headers: {
          "content-type": "application/pdf",
          "content-disposition": contentDisposition(documentFileName(kind, [order.name])),
          "cache-control": "no-store"
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
