import { connectDb } from "@/lib/db/mongoose";
import { SalesLead } from "@/models/Sales";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { record } from "@/lib/audit";
import { remarkEditSchema } from "@/lib/sales/leads";

type Stored = { name: string; remarks?: { _id: unknown; text: string; channel: string }[] };

/**
 * Correcting a remark.
 *
 * These get typed on a phone, standing in a shop doorway, between two numbers —
 * they have typos in them and they get filed against the wrong channel. The
 * alternative to letting them be fixed is somebody appending "* meant Tuesday"
 * underneath, which makes the thread harder to read every time.
 *
 * What cannot be edited is the timestamp or the author. Those are the two
 * things the thread is evidence *of*, and a remark whose date can be moved is
 * not a record of anything.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; remarkId: string }> }) {
  try {
    const auth = await apiSession(can.manageSales);
    if ("response" in auth) return auth.response;
    const { id, remarkId } = await params;
    if (!OBJECT_ID.test(id) || !OBJECT_ID.test(remarkId)) return badRequest("Unknown remark");
    await connectDb();

    const input = remarkEditSchema.parse(await request.json());

    // The positional `$` matches the array element the filter found, which is
    // why the remark id belongs in the filter rather than in a second query.
    const lead = await SalesLead.findOneAndUpdate(
      { _id: id, "remarks._id": remarkId },
      {
        $set: {
          ...(input.text !== undefined ? { "remarks.$.text": input.text } : {}),
          ...(input.channel !== undefined ? { "remarks.$.channel": input.channel } : {}),
          updatedBy: auth.session.userId
        }
      },
      { new: true }
    ).lean() as (Stored & Record<string, unknown>) | null;
    if (!lead) return badRequest("That remark is no longer there", 404);

    await record({
      actor: auth.session.userId,
      action: "sales.lead.remark.updated",
      entityType: "SalesLead",
      entityId: id,
      metadata: { name: lead.name, remarkId, ...input }
    });

    return ok(lead);
  } catch (error) {
    return fail(error);
  }
}

/**
 * Removes one remark from the thread.
 *
 * The contact tally is deliberately left alone. `contactCount` and
 * `lastContactedAt` record that somebody was reached out to, which is a thing
 * that happened in the world; deleting a badly-worded line about it does not
 * un-ring the phone, and decrementing here would quietly put a parlour back
 * into the outreach queue to be messaged a second time.
 *
 * The wording is copied onto the audit line before it goes, because after this
 * that line is the only remaining record that the conversation happened.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; remarkId: string }> }) {
  try {
    const auth = await apiSession(can.manageSales);
    if ("response" in auth) return auth.response;
    const { id, remarkId } = await params;
    if (!OBJECT_ID.test(id) || !OBJECT_ID.test(remarkId)) return badRequest("Unknown remark");
    await connectDb();

    const before = await SalesLead.findById(id).select("name remarks").lean() as Stored | null;
    const remark = before?.remarks?.find(entry => String(entry._id) === remarkId);
    if (!before || !remark) return badRequest("That remark is no longer there", 404);

    const lead = await SalesLead.findByIdAndUpdate(
      id,
      { $pull: { remarks: { _id: remarkId } }, $set: { updatedBy: auth.session.userId } },
      { new: true }
    ).lean();

    await record({
      actor: auth.session.userId,
      action: "sales.lead.remark.deleted",
      entityType: "SalesLead",
      entityId: id,
      metadata: { name: before.name, channel: remark.channel, text: remark.text }
    });

    return ok(lead);
  } catch (error) {
    return fail(error);
  }
}
