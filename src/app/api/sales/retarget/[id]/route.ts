import { connectDb } from "@/lib/db/mongoose";
import { SalesShopOrder } from "@/models/Sales";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { record } from "@/lib/audit";
import { followUpDate, retargetUpdateSchema } from "@/lib/sales/retarget";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.viewSales);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Unknown order");
    await connectDb();

    const row = await SalesShopOrder.findById(id).populate("rep", "name code").lean();
    if (!row) return badRequest("That order is not in the list", 404);
    return ok(row);
  } catch (error) {
    return fail(error);
  }
}

/**
 * The calling desk's own fields on an order: where the customer stands, the
 * standing note, when to ring next, and a corrected number.
 *
 * Only the `retarget` half is ever written here. What was ordered and whether
 * it arrived is the shop's and the courier's to say, and the sync rewrites it.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.retargetCustomers);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Unknown order");
    await connectDb();

    const input = retargetUpdateSchema.parse(await request.json());

    const set: Record<string, unknown> = {};
    const unset: Record<string, ""> = {};
    if (input.status !== undefined) set["retarget.status"] = input.status;
    if (input.notes !== undefined) {
      if (input.notes) set["retarget.notes"] = input.notes; else unset["retarget.notes"] = "";
    }
    if (input.nextFollowUp !== undefined) {
      if (input.nextFollowUp) set["retarget.nextFollowUpAt"] = followUpDate(input.nextFollowUp); else unset["retarget.nextFollowUpAt"] = "";
    }
    if (input.phone !== undefined) {
      if (input.phone) set["retarget.phone"] = input.phone; else unset["retarget.phone"] = "";
    }

    const row = await SalesShopOrder.findByIdAndUpdate(
      id,
      { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) },
      { new: true }
    ).populate("rep", "name code").lean() as { name?: string; customer?: { name?: string } } | null;
    if (!row) return badRequest("That order is not in the list", 404);

    await record({
      actor: auth.session.userId,
      action: "sales.retarget.updated",
      entityType: "SalesShopOrder",
      entityId: id,
      metadata: { order: row.name, customer: row.customer?.name, ...input }
    });

    return ok(row);
  } catch (error) {
    return fail(error);
  }
}
