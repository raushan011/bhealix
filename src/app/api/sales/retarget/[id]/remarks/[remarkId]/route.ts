import { connectDb } from "@/lib/db/mongoose";
import { SalesShopOrder } from "@/models/Sales";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { record } from "@/lib/audit";
import { retargetRemarkEditSchema } from "@/lib/sales/retarget";

type Remark = { _id: unknown; text: string; channel: string; at: Date };
type Stored = { name?: string; retarget?: { remarks?: Remark[] } };

/** The cached "last remark" fields, re-derived from whatever is left in the thread. */
function summaryOf(remarks: Remark[] = []) {
  const sorted = [...remarks].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const last = sorted[0];
  return last
    ? { $set: { "retarget.remarkCount": sorted.length, "retarget.lastRemark": last.text, "retarget.lastChannel": last.channel, "retarget.lastRemarkAt": last.at } }
    : { $set: { "retarget.remarkCount": 0 }, $unset: { "retarget.lastRemark": "", "retarget.lastChannel": "", "retarget.lastRemarkAt": "" } };
}

/** Correcting a remark: the words and the channel, never the time or the author. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; remarkId: string }> }) {
  try {
    const auth = await apiSession(can.retargetCustomers);
    if ("response" in auth) return auth.response;
    const { id, remarkId } = await params;
    if (!OBJECT_ID.test(id) || !OBJECT_ID.test(remarkId)) return badRequest("Unknown remark");
    await connectDb();

    const input = retargetRemarkEditSchema.parse(await request.json());

    const first = await SalesShopOrder.findOneAndUpdate(
      { _id: id, "retarget.remarks._id": remarkId },
      { $set: {
        ...(input.text !== undefined ? { "retarget.remarks.$.text": input.text } : {}),
        ...(input.channel !== undefined ? { "retarget.remarks.$.channel": input.channel } : {})
      } },
      { new: true }
    ).lean() as Stored | null;
    if (!first) return badRequest("That remark is no longer there", 404);

    const row = await SalesShopOrder.findByIdAndUpdate(id, summaryOf(first.retarget?.remarks), { new: true })
      .populate("rep", "name code").lean();

    await record({
      actor: auth.session.userId,
      action: "sales.retarget.remark.updated",
      entityType: "SalesShopOrder",
      entityId: id,
      metadata: { order: first.name, remarkId, ...input }
    });

    return ok(row);
  } catch (error) {
    return fail(error);
  }
}

/**
 * Removes one remark. The contact tally is left alone — deleting a badly-worded
 * line does not un-ring the phone.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; remarkId: string }> }) {
  try {
    const auth = await apiSession(can.retargetCustomers);
    if ("response" in auth) return auth.response;
    const { id, remarkId } = await params;
    if (!OBJECT_ID.test(id) || !OBJECT_ID.test(remarkId)) return badRequest("Unknown remark");
    await connectDb();

    const before = await SalesShopOrder.findOne({ _id: id, "retarget.remarks._id": remarkId })
      .select("name retarget.remarks").lean() as Stored | null;
    if (!before) return badRequest("That remark is no longer there", 404);
    const gone = before.retarget?.remarks?.find(remark => String(remark._id) === remarkId);
    const remaining = (before.retarget?.remarks ?? []).filter(remark => String(remark._id) !== remarkId);

    const summary = summaryOf(remaining);
    const row = await SalesShopOrder.findByIdAndUpdate(
      id,
      { $pull: { "retarget.remarks": { _id: remarkId } }, ...summary },
      { new: true }
    ).populate("rep", "name code").lean();

    await record({
      actor: auth.session.userId,
      action: "sales.retarget.remark.deleted",
      entityType: "SalesShopOrder",
      entityId: id,
      metadata: { order: before.name, remarkId, text: gone?.text, channel: gone?.channel }
    });

    return ok(row);
  } catch (error) {
    return fail(error);
  }
}
