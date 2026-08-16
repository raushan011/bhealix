import { connectDb } from "@/lib/db/mongoose";
import { SalesLead } from "@/models/Sales";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { record } from "@/lib/audit";
import { isOutreach, remarkSchema } from "@/lib/sales/leads";
import { advancesOnSend } from "@/lib/sales/outreach";

/**
 * Writes down what happened on a call.
 *
 * The remark, the status it left the lead in, and the fact that somebody
 * reached out all land in one request, because on the screen they are one
 * action: you ring a parlour, and then you say how it went. Splitting them into
 * three calls would mean three ways for a phone on a patchy connection to save
 * half of it — and half of it is a lead marked `Contacted` with no record of
 * what was said, which is the state this whole thread exists to prevent.
 *
 * The contact tally moves only for a channel that actually reached somebody
 * (§ `isOutreach`). Filing a note to self must not take a lead out of the
 * outreach queue; that queue's entire job is to find the parlours nobody has
 * messaged, and a lead removed from it by a note is a lead nobody ever contacts.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.manageSales);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Unknown lead");
    await connectDb();

    const input = remarkSchema.parse(await request.json());

    const lead = await SalesLead.findById(id).select("name status").lean() as
      { name: string; status: string } | null;
    if (!lead) return badRequest("That lead is no longer in the list", 404);

    const reached = isOutreach(input.channel);
    /**
     * An explicit choice on the screen wins. Failing that, a call that reached
     * somebody moves a lead off `New` — and only off `New`, for the reason
     * `advancesOnSend` gives: a lead already marked `Interested` is further
     * along than "we spoke to them", and a follow-up must not drag it back.
     */
    const status = input.status ?? (reached && advancesOnSend(lead.status) ? "Contacted" : undefined);

    const remark = {
      text: input.text,
      channel: input.channel,
      status,
      at: new Date(),
      by: auth.session.userId,
      byName: auth.session.name || undefined
    };

    const updated = await SalesLead.findByIdAndUpdate(
      id,
      {
        $push: { remarks: remark },
        $set: {
          updatedBy: auth.session.userId,
          ...(status ? { status } : {}),
          ...(reached ? { lastContactedAt: remark.at } : {})
        },
        ...(reached ? { $inc: { contactCount: 1 } } : {})
      },
      { new: true }
    ).lean();

    await record({
      actor: auth.session.userId,
      action: "sales.lead.remarked",
      entityType: "SalesLead",
      entityId: id,
      metadata: { name: lead.name, channel: input.channel, status, text: input.text }
    });

    return ok(updated, 201);
  } catch (error) {
    return fail(error);
  }
}
