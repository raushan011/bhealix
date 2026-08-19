import { connectDb } from "@/lib/db/mongoose";
import { SalesAutomationRule, SalesOutreachMessage } from "@/models/Sales";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { record } from "@/lib/audit";
import { ruleUpdateSchema } from "@/lib/sales/automation";
import { drainQueue, queueExisting } from "@/lib/sales/outreach-engine";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const auth = await apiSession(can.manageSales);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Unknown rule");
    await connectDb();

    const input = ruleUpdateSchema.parse(await request.json());
    const rule = await SalesAutomationRule.findByIdAndUpdate(id, { $set: { ...input, updatedBy: auth.session.userId } }, { new: true }).lean();
    if (!rule) return badRequest("That rule no longer exists", 404);

    await record({
      actor: auth.session.userId,
      action: "sales.automation.rule.updated",
      entityType: "SalesAutomationRule",
      entityId: id,
      metadata: input as Record<string, unknown>
    });

    return ok(rule);
  } catch (error) {
    return fail(error);
  }
}

/**
 * Deleting a rule leaves its log alone. What was sent was sent, and each row
 * carries the rule's name as a snapshot for exactly this moment (§4.10).
 * Anything still queued under it is dropped — nobody should be messaged by an
 * instruction that has been withdrawn.
 */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const auth = await apiSession(can.manageSales);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Unknown rule");
    await connectDb();

    const rule = await SalesAutomationRule.findByIdAndDelete(id).lean() as { name?: string } | null;
    if (!rule) return badRequest("That rule no longer exists", 404);
    const dropped = await SalesOutreachMessage.deleteMany({ rule: id, status: "Queued" });

    await record({
      actor: auth.session.userId,
      action: "sales.automation.rule.deleted",
      entityType: "SalesAutomationRule",
      entityId: id,
      metadata: { name: rule.name, queuedDropped: dropped.deletedCount }
    });

    return ok({ deleted: true, queuedDropped: dropped.deletedCount });
  } catch (error) {
    return fail(error);
  }
}

/**
 * "Send to the leads I already have" — runs the rule over the saved list, for
 * the sweep that was saved before the rule was written, and drains what it
 * queued straight away.
 */
export async function POST(_request: Request, { params }: Params) {
  try {
    const auth = await apiSession(can.manageSales);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Unknown rule");
    await connectDb();

    const queued = await queueExisting(id);
    const drained = queued.queued ? await drainQueue({ trigger: "Manual" }) : null;

    await record({
      actor: auth.session.userId,
      action: "sales.automation.queued",
      entityType: "SalesAutomationRule",
      entityId: id,
      metadata: { queued: queued.queued, skipped: queued.skipped as unknown as Record<string, number>, sent: drained?.sent, failed: drained?.failed }
    });

    return ok({ queued, drained });
  } catch (error) {
    return fail(error);
  }
}
