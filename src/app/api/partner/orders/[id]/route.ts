import { Types } from "mongoose";
import { connectDb } from "@/lib/db/mongoose";
import { SalesOrder } from "@/models/Sales";
import { apiPartner } from "@/lib/auth/partner";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { commissionForPartner } from "@/lib/sales/commission-payment";
import { trackingHeadline, trackOrder, trackingProgress } from "@/lib/sales/tracking";

/**
 * One order, told as a sequence of steps.
 *
 * The ownership check is part of the query rather than a comparison afterwards.
 * Finding the order and then testing whose it is works until somebody adds an
 * early return above the test; asking the database for "this order, belonging to
 * this rep" cannot be got wrong later, because there is no intermediate state in
 * which the wrong order has been loaded.
 *
 * An order belonging to another rep answers 404, not 403. A 403 would confirm
 * that the id exists — which, for sequential-looking order ids, is a way to
 * count somebody else's business.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiPartner();
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("No such order", 404);
    await connectDb();

    const order = await SalesOrder.findOne({ _id: id, rep: new Types.ObjectId(String(auth.rep._id)) })
      .select("name placedAt couponCode ruleSuffix customer items totals paymentMethod financialStatus cancelledAt fullyRefunded shipment delivery commission source")
      .lean() as Record<string, unknown> | null;

    if (!order) return badRequest("No such order", 404);

    const steps = trackOrder(order as never);

    return ok({
      order: commissionForPartner(order as { commission?: { payment?: { paidBy?: unknown } } }),
      steps,
      headline: trackingHeadline(order as never),
      progress: trackingProgress(steps)
    });
  } catch (error) {
    return fail(error);
  }
}
