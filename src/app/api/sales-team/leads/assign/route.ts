import { Types } from "mongoose";
import { connectDb } from "@/lib/db/mongoose";
import { SalesLead } from "@/models/Sales";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok } from "@/lib/api";
import { record } from "@/lib/audit";
import { assignSchema } from "@/lib/sales-team/schemas";
import { activeExecutive } from "@/lib/sales-team/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Hands leads to a sales executive — or, with `executive: null`, takes them back.
 *
 * Reassigning keeps every remark already on the lead: whoever picks it up next
 * should read "call back after Diwali" before they dial, not discover it from
 * the customer. A converted lead is left where it is, because the order it
 * became already belongs to whoever converted it.
 */
export async function POST(request: Request) {
  try {
    const auth = await apiSession(can.manageSalesTeam);
    if ("response" in auth) return auth.response;
    await connectDb();

    const input = assignSchema.parse(await request.json());
    const ids = input.leadIds.map(id => new Types.ObjectId(id));

    let executive: { _id: Types.ObjectId; name: string } | null = null;
    if (input.executive) {
      executive = await activeExecutive(input.executive);
      if (!executive) return badRequest("That person is not an active sales executive.");
    }

    const result = await SalesLead.updateMany(
      { _id: { $in: ids }, status: { $ne: "Converted" } },
      executive
        ? { $set: { assignedTo: executive._id, assignedAt: new Date(), assignedBy: auth.session.userId, updatedBy: auth.session.userId } }
        : { $unset: { assignedTo: "", assignedAt: "", assignedBy: "" }, $set: { updatedBy: auth.session.userId } }
    );

    await record({
      actor: auth.session.userId, action: "team.leads.assigned", entityType: "SalesLead",
      entityId: result.modifiedCount === 1 ? input.leadIds[0] : `${result.modifiedCount} leads`,
      metadata: { to: executive?.name ?? null, count: result.modifiedCount }
    });

    const skipped = input.leadIds.length - result.modifiedCount;
    return ok({
      assigned: result.modifiedCount,
      message: executive
        ? `${result.modifiedCount} lead${result.modifiedCount === 1 ? "" : "s"} handed to ${executive.name}.${skipped ? ` ${skipped} already converted or unchanged.` : ""}`
        : `${result.modifiedCount} lead${result.modifiedCount === 1 ? "" : "s"} taken back to the desk.`
    });
  } catch (error) {
    return fail(error);
  }
}
