import { connectDb } from "@/lib/db/mongoose";
import { SalesTeamOrder } from "@/models/SalesTeam";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { record } from "@/lib/audit";
import { IntegrationError } from "@/lib/sales/http";
import { loadCredentials, shiprocketToken } from "@/lib/sales/settings";
import { ndrAction } from "@/lib/sales/shiprocket";
import { todayIso } from "@/lib/time";
import { mayActOn, orderScope } from "@/lib/sales-team/access";
import { ndrSchema } from "@/lib/sales-team/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reattempt, reschedule or return a parcel the courier could not deliver —
 * decided by the executive who has just spoken to the customer, and sent to
 * Shiprocket from here rather than waiting for somebody to work the NDR queue
 * in Shiprocket's own panel.
 *
 * Every attempt is written onto the order whether Shiprocket accepted it or not,
 * with Shiprocket's answer: "I asked for Saturday and was refused" is exactly the
 * thing the next person to look at the order needs to know.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.placeSalesOrder);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Unknown order");
    await connectDb();

    const input = ndrSchema.parse(await request.json());
    const order = await SalesTeamOrder.findOne({ _id: id, ...(orderScope(auth.session) ?? {}) });
    if (!order) return badRequest("That order could not be found", 404);
    if (!mayActOn(auth.session, order.executive)) return badRequest("You do not have access to this action", 403);

    const awb = String(order.shipment?.awb ?? "").trim();
    if (!awb) return badRequest("This order has not been shipped yet, so there is no delivery to reattempt.");
    if (order.cancelledAt || ["Delivered", "RTO", "Returned", "Cancelled", "Lost"].includes(order.delivery?.state)) {
      return badRequest(`This parcel is already ${String(order.delivery?.state ?? "settled").toLowerCase()} — there is nothing left to reattempt.`);
    }
    if (input.deferredDate && input.deferredDate < todayIso()) return badRequest("Choose today or a later day.");

    const token = await shiprocketToken(await loadCredentials());
    if (!token) return badRequest("Shiprocket is not connected.", 502);

    let answer: { ok: boolean; message: string };
    try {
      const result = await ndrAction(token, awb, {
        action: input.action,
        comments: input.comments,
        deferredDate: input.deferredDate || undefined,
        phone: input.phone || undefined,
        address1: input.address1 || undefined,
        address2: input.address2 || undefined
      });
      answer = { ok: true, message: result.message || "Shiprocket accepted the request." };
    } catch (error) {
      if (!(error instanceof IntegrationError)) throw error;
      answer = { ok: false, message: error.message };
    }

    order.ndr.push({
      action: input.action, deferredDate: input.deferredDate || undefined, phone: input.phone || undefined,
      address1: input.address1 || undefined, address2: input.address2 || undefined, comments: input.comments,
      ok: answer.ok, response: answer.message, at: new Date(), by: auth.session.userId, byName: auth.session.name || undefined
    });
    if (answer.ok && input.action === "re-attempt" && input.deferredDate) order.set("shipment.expectedDelivery", input.deferredDate);
    await order.save();

    await record({
      actor: auth.session.userId, action: "team.order.ndr", entityType: "SalesTeamOrder", entityId: order._id,
      metadata: { name: order.name, awb, ...input, ok: answer.ok, response: answer.message }
    });

    return answer.ok ? ok({ message: answer.message }) : badRequest(`Shiprocket did not accept it: ${answer.message}`, 502);
  } catch (error) {
    return fail(error);
  }
}
