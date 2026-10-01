import { Types } from "mongoose";
import { connectDb } from "@/lib/db/mongoose";
import { SalesTeamOrder } from "@/models/SalesTeam";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { record } from "@/lib/audit";
import { dayRange } from "@/lib/time";
import { isExecutive, orderScope } from "@/lib/sales-team/access";
import { INCENTIVE_STATUSES } from "@/lib/sales-team/orders";
import { payIncentiveSchema, unpayIncentiveSchema } from "@/lib/sales-team/schemas";
import { executiveSummaries, recalculateIncentive, totalOf } from "@/lib/sales-team/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FIELDS = "name placedAt executive executiveName customer.name totals.paid paymentMode delivery.state delivery.at "
  + "shipment.deliveredAt incentive cancelledAt";

/**
 * Incentives, order by order, with the totals per executive above them.
 *
 * An executive sees only their own — the same rule as everywhere in the sales
 * team's records, and the one that matters most here, because this is pay.
 */
export async function GET(request: Request) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    const scope = orderScope(auth.session);
    if (!scope) return badRequest("You do not have access to the sales team's incentives", 403);
    await connectDb();

    const params = new URL(request.url).searchParams;
    const and: Record<string, unknown>[] = [scope];
    const executive = params.get("executive");
    if (executive && OBJECT_ID.test(executive) && !isExecutive(auth.session)) and.push({ executive: new Types.ObjectId(executive) });
    const placed = dayRange(params.get("from"), params.get("to"));
    if (placed) and.push({ placedAt: placed });

    const status = params.get("status");
    const listed = [...and];
    if (status && (INCENTIVE_STATUSES as readonly string[]).includes(status)) listed.push({ "incentive.status": status });
    if (params.get("attention") === "1") listed.push({ "incentive.needsReversal": true });

    const [items, summaries] = await Promise.all([
      SalesTeamOrder.find({ $and: listed }).select(FIELDS)
        .populate("incentive.payment.paidBy", "name")
        .sort({ "delivery.at": -1, placedAt: -1 }).limit(500).lean(),
      executiveSummaries({ $and: and }, isExecutive(auth.session) ? auth.session.userId : undefined)
    ]);

    return ok({
      items,
      summaries: isExecutive(auth.session) ? summaries : summaries.filter(row => row.orders || row.executive.active),
      totals: totalOf(summaries),
      mayPay: can.paySalesIncentive(auth.session.role)
    });
  } catch (error) {
    return fail(error);
  }
}

/**
 * Marks incentives paid — or undoes one payment marked in error.
 *
 * Paying is one conditional write matched on `status: "Payable"`, the same
 * guard the affiliate commission uses (§4.13b): two administrators pressing Pay
 * on the same orders at once cannot both succeed, and an order that is not
 * delivered — or has already been paid — is simply not matched, and the reply
 * says how many were.
 */
export async function POST(request: Request) {
  try {
    const auth = await apiSession(can.paySalesIncentive);
    if ("response" in auth) return auth.response;
    await connectDb();

    const body = await request.json() as { action?: string };

    if (body.action === "undo") {
      const input = unpayIncentiveSchema.parse(body);
      const order = await SalesTeamOrder.findById(input.orderId);
      if (!order) return badRequest("That order could not be found", 404);
      if (order.incentive?.status !== "Paid") return badRequest("This incentive has not been marked paid.");

      const was = { amount: order.incentive.amount, payment: order.incentive.payment };
      order.set("incentive.status", "Pending");
      order.set("incentive.payment", undefined);
      // Re-priced from scratch, so a parcel that came back since lands as Void
      // rather than as money owed twice.
      recalculateIncentive(order);
      await order.save();

      await record({
        actor: auth.session.userId, action: "team.incentive.unpaid", entityType: "SalesTeamOrder", entityId: order._id,
        metadata: { name: order.name, executive: order.executiveName, amount: was.amount, reason: input.reason, payment: was.payment }
      });
      return ok({ status: order.incentive.status });
    }

    const input = payIncentiveSchema.parse(body);
    const ids = input.orderIds.map(id => new Types.ObjectId(id));
    const payment = {
      paidAt: new Date(),
      paidBy: auth.session.userId,
      paymentDate: input.paymentDate,
      mode: input.mode,
      reference: input.reference || undefined,
      note: input.note || undefined
    };

    const payable = await SalesTeamOrder.find({ _id: { $in: ids }, "incentive.status": "Payable" })
      .select("name executiveName incentive.amount").lean() as unknown as Array<{ _id: Types.ObjectId; name: string; executiveName?: string; incentive: { amount: number } }>;
    const result = await SalesTeamOrder.updateMany(
      { _id: { $in: payable.map(order => order._id) }, "incentive.status": "Payable" },
      { $set: { "incentive.status": "Paid", "incentive.payment": payment, "incentive.reason": undefined } }
    );

    const amount = payable.reduce((sum, order) => sum + Number(order.incentive?.amount ?? 0), 0);
    if (result.modifiedCount) {
      await record({
        actor: auth.session.userId, action: "team.incentive.paid", entityType: "SalesTeamOrder",
        entityId: result.modifiedCount === 1 ? payable[0]._id : `${result.modifiedCount} orders`,
        metadata: { orders: payable.map(order => order.name), executives: [...new Set(payable.map(order => order.executiveName))], amount, ...payment, paidBy: undefined }
      });
    }

    const skipped = input.orderIds.length - result.modifiedCount;
    return ok({
      paid: result.modifiedCount,
      amount,
      skipped,
      message: result.modifiedCount
        ? `Marked ${result.modifiedCount} incentive${result.modifiedCount === 1 ? "" : "s"} paid — ₹${amount.toLocaleString("en-IN")}.${skipped ? ` ${skipped} were not payable and were left alone.` : ""}`
        : "None of these incentives were payable. They may already be paid, or not delivered yet."
    });
  } catch (error) {
    return fail(error);
  }
}
