import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { SalesOrder } from "@/models/Sales";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { record } from "@/lib/audit";
import { recalculateCommission } from "@/lib/sales/commission";
import { DELIVERY_STATES } from "@/lib/sales/constants";
import { loadSettings, rulesOf } from "@/lib/sales/settings";

const patchSchema = z.object({
  /** `null` clears the override and hands the decision back to the courier's feed. */
  override: z.enum(DELIVERY_STATES).nullable().optional(),
  overrideReason: z.string().trim().max(300).optional(),
  notes: z.string().trim().max(500).optional()
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.viewSales);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Not a valid order id");
    await connectDb();

    const order = await SalesOrder.findById(id)
      .populate("rep", "name code phone payMethod upiId bankName bankAccountName bankAccountNo bankIfsc")
      .populate("commission.payment.paidBy", "name")
      .lean();
    if (!order) return badRequest("No such order", 404);
    return ok(order);
  } catch (error) {
    return fail(error);
  }
}

/**
 * Correcting an order by hand.
 *
 * The override exists because the courier's feed is not the last word on what
 * happened: a partial delivery settled with the customer, a status Shiprocket
 * has not taught us to read, a parcel the rep knows arrived. It decides whether
 * an order pays out, so it is the administrator's alone and it leaves a line in
 * the audit trail naming who moved it and why.
 *
 * A commission that has already been paid keeps its figure — the override
 * flags it for reversal rather than rewriting the record of a payment.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.manageSales);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Not a valid order id");
    await connectDb();

    const input = patchSchema.parse(await request.json());
    const order = await SalesOrder.findById(id);
    if (!order) return badRequest("No such order", 404);

    const before = order.delivery.state;

    if (input.override !== undefined) {
      if (input.override === null) {
        order.delivery.override = undefined;
        order.delivery.overrideReason = undefined;
        order.delivery.overrideBy = undefined;
        order.delivery.overrideAt = undefined;
      } else {
        order.delivery.override = input.override;
        order.delivery.overrideReason = input.overrideReason;
        order.delivery.overrideBy = auth.session.userId;
        order.delivery.overrideAt = new Date();
      }
    }
    if (input.notes !== undefined) order.notes = input.notes;

    const settings = await loadSettings();
    recalculateCommission(order, rulesOf(settings));
    if (order.delivery.state !== before) order.delivery.at = new Date();
    await order.save();

    if (input.override !== undefined) {
      await record({
        actor: auth.session.userId,
        action: "sales.delivery.overridden",
        entityType: "SalesOrder",
        entityId: String(order._id),
        metadata: { order: order.name, from: before, to: order.delivery.state, reason: input.overrideReason }
      });
    }

    return ok({
      _id: order._id,
      delivery: order.delivery,
      commission: order.commission
    });
  } catch (error) {
    return fail(error);
  }
}
