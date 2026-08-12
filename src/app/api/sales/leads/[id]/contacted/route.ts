import { connectDb } from "@/lib/db/mongoose";
import { SalesLead } from "@/models/Sales";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { record } from "@/lib/audit";
import { advancesOnSend, contactedSchema } from "@/lib/sales/outreach";

/**
 * Records that somebody opened WhatsApp against this lead.
 *
 * Called the moment the link is tapped, not after the message lands — because
 * there is no "after". WhatsApp hands the tap off to another application and
 * tells this one nothing, so a send can be *offered* and never confirmed. Two
 * ways to be wrong, then, and they are not equal: recording a message that was
 * not sent leaves a parlour un-messaged, which the next sweep of the list picks
 * up. Not recording one that was leaves somebody messaging the same shop twice
 * in a week, which is the thing that gets a number blocked.
 *
 * So the optimistic write, and the queue's skip button for when the tap was a
 * mistake.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.manageSales);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Unknown lead");
    await connectDb();

    // An empty body is a legitimate call — the queue always knows the message,
    // but a bare "mark this contacted" is a reasonable thing to want.
    const input = contactedSchema.parse(await request.json().catch(() => ({})));

    const lead = await SalesLead.findById(id).lean() as { status: string; name: string } | null;
    if (!lead) return badRequest("That lead is no longer in the list", 404);

    const updated = await SalesLead.findByIdAndUpdate(
      id,
      {
        $set: {
          lastContactedAt: new Date(),
          updatedBy: auth.session.userId,
          ...(advancesOnSend(lead.status) ? { status: "Contacted" } : {})
        },
        $inc: { contactCount: 1 }
      },
      { new: true }
    ).lean();

    await record({
      actor: auth.session.userId,
      action: "sales.lead.messaged",
      entityType: "SalesLead",
      entityId: id,
      // The wording is kept verbatim. Six months on, "why did this parlour
      // reply angrily" is answered by what was actually said to them, and not
      // by whichever template happens to carry that name today.
      metadata: { name: lead.name, message: input.message, templateId: input.templateId }
    });

    return ok(updated);
  } catch (error) {
    return fail(error);
  }
}
