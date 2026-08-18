import { connectDb } from "@/lib/db/mongoose";
import { SalesShopOrder } from "@/models/Sales";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { record } from "@/lib/audit";
import { isOutreach } from "@/lib/sales/leads";
import { followUpDate, retargetRemarkSchema } from "@/lib/sales/retarget";

/**
 * Writes down what happened on a call to a customer.
 *
 * The remark, the status it leaves the customer in, the follow-up date and the
 * fact that somebody reached out all land in one request, because on the
 * screen they are one action: you ring, and then you say how it went. The
 * cached `lastRemark` / `remarkCount` fields exist so the list can show the
 * last line and filter on "never remarked" without unwinding the thread on
 * every page.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.retargetCustomers);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Unknown order");
    await connectDb();

    const input = retargetRemarkSchema.parse(await request.json());
    const existing = await SalesShopOrder.findById(id).select("name customer.name retarget.status").lean() as
      { name?: string; customer?: { name?: string }; retarget?: { status?: string } } | null;
    if (!existing) return badRequest("That order is not in the list", 404);

    const reached = isOutreach(input.channel);
    const at = new Date();
    const remark = { text: input.text, channel: input.channel, status: input.status, at, by: auth.session.userId, byName: auth.session.name || undefined };

    const set: Record<string, unknown> = {
      "retarget.lastRemarkAt": at,
      "retarget.lastRemark": input.text,
      "retarget.lastChannel": input.channel,
      ...(input.status ? { "retarget.status": input.status } : {}),
      ...(reached ? { "retarget.lastContactedAt": at } : {})
    };
    const unset: Record<string, ""> = {};
    if (input.nextFollowUp !== undefined) {
      if (input.nextFollowUp) set["retarget.nextFollowUpAt"] = followUpDate(input.nextFollowUp);
      else unset["retarget.nextFollowUpAt"] = "";
    }

    const updated = await SalesShopOrder.findByIdAndUpdate(
      id,
      {
        $push: { "retarget.remarks": remark },
        $set: set,
        ...(Object.keys(unset).length ? { $unset: unset } : {}),
        $inc: { "retarget.remarkCount": 1, ...(reached ? { "retarget.contactCount": 1 } : {}) }
      },
      { new: true }
    ).populate("rep", "name code").lean();

    await record({
      actor: auth.session.userId,
      action: "sales.retarget.remarked",
      entityType: "SalesShopOrder",
      entityId: id,
      metadata: { order: existing.name, customer: existing.customer?.name, channel: input.channel, status: input.status, text: input.text }
    });

    return ok(updated, 201);
  } catch (error) {
    return fail(error);
  }
}
