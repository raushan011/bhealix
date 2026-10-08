import { Types } from "mongoose";
import { connectDb } from "@/lib/db/mongoose";
import { SalesTeamOrder } from "@/models/SalesTeam";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok } from "@/lib/api";
import { record } from "@/lib/audit";
import { isExecutive } from "@/lib/sales-team/access";
import { orderAssignSchema } from "@/lib/sales-team/schemas";
import { activeExecutive } from "@/lib/sales-team/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Moves a batch of orders to the executive whose sale they were — for when one
 * colleague typed in orders a newer one closed on the phone. The same move as
 * "Move to another executive" on a single order, for many at once: the
 * incentive goes with the order, and an order whose incentive has already been
 * paid stays where it is until that payment is undone.
 */
export async function POST(request: Request) {
  try {
    const auth = await apiSession(can.manageSalesTeam);
    if ("response" in auth) return auth.response;
    if (isExecutive(auth.session)) return badRequest("Only an administrator can move an order", 403);
    await connectDb();

    const input = orderAssignSchema.parse(await request.json());
    const executive = await activeExecutive(input.executive);
    if (!executive) return badRequest("That person is not an active sales executive.");

    const orders = await SalesTeamOrder.find({ _id: { $in: input.orderIds.map(id => new Types.ObjectId(id)) } })
      .select("name executive executiveName incentive.status").lean() as unknown as Array<{
        _id: Types.ObjectId; name: string; executive: Types.ObjectId; executiveName?: string; incentive?: { status?: string };
      }>;
    const paid = orders.filter(order => order.incentive?.status === "Paid");
    const moving = orders.filter(order => order.incentive?.status !== "Paid" && String(order.executive) !== String(executive._id));

    if (moving.length) {
      await SalesTeamOrder.updateMany(
        { _id: { $in: moving.map(order => order._id) }, "incentive.status": { $ne: "Paid" } },
        { $set: { executive: executive._id, executiveName: executive.name } }
      );
      // One entry per order, so each one's history says whose it was before.
      await Promise.all(moving.map(order => record({
        actor: auth.session.userId, action: "team.order.reassigned", entityType: "SalesTeamOrder", entityId: order._id,
        metadata: { name: order.name, from: order.executiveName, to: executive.name, bulk: true }
      })));
    }

    const already = orders.length - moving.length - paid.length;
    const notes = [
      paid.length ? `${paid.length} kept back — incentive already paid (${paid.map(order => order.name).join(", ")}).` : "",
      already ? `${already} already ${executive.name}'s.` : ""
    ].filter(Boolean).join(" ");
    return ok({
      moved: moving.length,
      message: `${moving.length} order${moving.length === 1 ? "" : "s"} moved to ${executive.name}.${notes ? ` ${notes}` : ""}`
    });
  } catch (error) {
    return fail(error);
  }
}
