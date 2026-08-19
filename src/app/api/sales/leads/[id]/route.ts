import { connectDb } from "@/lib/db/mongoose";
import { SalesLead } from "@/models/Sales";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { record } from "@/lib/audit";
import { canonicalType, leadUpdateSchema } from "@/lib/sales/leads";

/** Working the list: where a lead got to, and what was said. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.manageSales);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Unknown lead");
    await connectDb();

    const input = leadUpdateSchema.parse(await request.json());
    // A corrected type joins an existing spelling case-blind rather than
    // opening a near-duplicate entry in the filter.
    if (input.type) input.type = canonicalType(input.type, await SalesLead.distinct("type") as string[]);
    const lead = await SalesLead.findByIdAndUpdate(
      id,
      { ...input, updatedBy: auth.session.userId },
      { new: true }
    ).lean() as { _id: unknown; name: string; status: string } | null;
    if (!lead) return badRequest("That lead is no longer in the list", 404);

    await record({
      actor: auth.session.userId,
      action: "sales.lead.updated",
      entityType: "SalesLead",
      entityId: id,
      metadata: { name: lead.name, ...input }
    });

    return ok(lead);
  } catch (error) {
    return fail(error);
  }
}

/**
 * Removes a lead outright.
 *
 * Deleted rather than archived, unlike a doctor or a product (§4.10): nothing
 * anywhere points at a lead — no order, no visit, no payout line — so there is
 * no history for a tombstone to protect. A parlour struck off the list is one
 * somebody decided was not worth a second call, and leaving it there greyed out
 * would only make the list harder to work.
 *
 * A later sweep of the same area will find it again, which is correct: Google
 * still has it, and it is the same shopfront it was.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.manageSales);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Unknown lead");
    await connectDb();

    const lead = await SalesLead.findByIdAndDelete(id).lean() as { name: string; type: string } | null;
    if (!lead) return badRequest("That lead is no longer in the list", 404);

    await record({
      actor: auth.session.userId,
      action: "sales.lead.deleted",
      entityType: "SalesLead",
      entityId: id,
      metadata: { name: lead.name, type: lead.type }
    });

    return ok({ deleted: true });
  } catch (error) {
    return fail(error);
  }
}
