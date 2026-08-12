import { connectDb } from "@/lib/db/mongoose";
import { SalesTemplate } from "@/models/Sales";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { record } from "@/lib/audit";
import { templateUpdateSchema } from "@/lib/sales/outreach";

/** Rewording one. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.manageSales);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Unknown template");
    await connectDb();

    const input = templateUpdateSchema.parse(await request.json());
    const template = await SalesTemplate.findByIdAndUpdate(
      id,
      { ...input, updatedBy: auth.session.userId },
      { new: true }
    ).lean() as { _id: unknown; name: string } | null;
    if (!template) return badRequest("That template is no longer saved", 404);

    await record({
      actor: auth.session.userId,
      action: "sales.template.updated",
      entityType: "SalesTemplate",
      entityId: id,
      metadata: { name: template.name }
    });

    return ok(template);
  } catch (error) {
    return fail(error);
  }
}

/**
 * Removes a template outright.
 *
 * Deleted rather than archived, like the leads it is used against. A template
 * is the wording of a message, not a record of one — what was actually sent is
 * on the audit trail and on the lead's own contact count, and neither of those
 * reaches back here for the text. There is nothing left pointing at it.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.manageSales);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Unknown template");
    await connectDb();

    const template = await SalesTemplate.findByIdAndDelete(id).lean() as { name: string } | null;
    if (!template) return badRequest("That template is no longer saved", 404);

    await record({
      actor: auth.session.userId,
      action: "sales.template.deleted",
      entityType: "SalesTemplate",
      entityId: id,
      metadata: { name: template.name }
    });

    return ok({ deleted: true });
  } catch (error) {
    return fail(error);
  }
}
