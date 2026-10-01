import { connectDb } from "@/lib/db/mongoose";
import { SalesLead } from "@/models/Sales";
import { SalesTeamOrder } from "@/models/SalesTeam";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { record } from "@/lib/audit";
import { isOutreach, remarkSchema } from "@/lib/sales/leads";
import { advancesOnSend } from "@/lib/sales/outreach";
import { isExecutive, leadScope, orderScope } from "@/lib/sales-team/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** One lead in full — its remarks, and any orders placed from it. */
export async function GET(_: Request, { params }: Params) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    const scope = leadScope(auth.session);
    if (!scope) return badRequest("You do not have access to the sales team's leads", 403);
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Unknown lead");
    await connectDb();

    const lead = await SalesLead.findOne({ _id: id, ...scope }).populate("assignedTo", "name").lean() as
      ({ remarks?: Array<{ at: Date }> } & Record<string, unknown>) | null;
    if (!lead) return badRequest("That lead is not in your list", 404);

    const orders = await SalesTeamOrder.find({ lead: id, ...(orderScope(auth.session) ?? {}) })
      .select("name placedAt totals.paid paymentMode delivery.state cancelledAt").sort({ placedAt: -1 }).lean();
    const remarks = [...(lead.remarks ?? [])].sort((left, right) => +new Date(right.at) - +new Date(left.at));

    return ok({ lead: { ...lead, remarks }, orders });
  } catch (error) {
    return fail(error);
  }
}

/**
 * Writes down how a call went — the remark, where it left the lead, and that
 * somebody reached out, all in one request, as on the Leads CRM's own screen.
 *
 * An executive may only remark on a lead handed to them. `Converted` is not
 * theirs to set by hand: it is what placing an order does, so a lead can never
 * read as converted with no order behind it.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    const mayWrite = isExecutive(auth.session) || can.manageSalesTeam(auth.session.role);
    const scope = leadScope(auth.session);
    if (!mayWrite || !scope) return badRequest("You do not have access to this action", 403);
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Unknown lead");
    await connectDb();

    const input = remarkSchema.parse(await request.json());
    if (input.status === "Converted") return badRequest("A lead becomes Converted when an order is placed from it. Use New order instead.");

    const lead = await SalesLead.findOne({ _id: id, ...scope }).select("name status").lean() as { name: string; status: string } | null;
    if (!lead) return badRequest("That lead is not in your list", 404);

    const reached = isOutreach(input.channel);
    const status = input.status ?? (reached && advancesOnSend(lead.status) ? "Contacted" : undefined);
    const remark = { text: input.text, channel: input.channel, status, at: new Date(), by: auth.session.userId, byName: auth.session.name || undefined };

    await SalesLead.updateOne({ _id: id }, {
      $push: { remarks: remark },
      $set: { updatedBy: auth.session.userId, ...(status ? { status } : {}), ...(reached ? { lastContactedAt: remark.at } : {}) },
      ...(reached ? { $inc: { contactCount: 1 } } : {})
    });

    await record({
      actor: auth.session.userId, action: "team.lead.remarked", entityType: "SalesLead", entityId: id,
      metadata: { name: lead.name, channel: input.channel, status, text: input.text }
    });
    return ok({ status: status ?? lead.status }, 201);
  } catch (error) {
    return fail(error);
  }
}
