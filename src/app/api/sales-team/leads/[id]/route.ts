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
import { followUpSchema } from "@/lib/sales-team/schemas";

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

    const body = await request.json() as Record<string, unknown>;
    const input = remarkSchema.parse(body);
    // The next call, decided on this one: a day sets it, null clears it, absent leaves it.
    const next = "followUpAt" in body ? followUpSchema.parse({ followUpAt: body.followUpAt ?? null, followUpNote: body.followUpNote }) : null;
    if (input.status === "Converted") return badRequest("A lead becomes Converted when an order is placed from it. Use New order instead.");

    const lead = await SalesLead.findOne({ _id: id, ...scope }).select("name status").lean() as { name: string; status: string } | null;
    if (!lead) return badRequest("That lead is not in your list", 404);

    const reached = isOutreach(input.channel);
    const status = input.status ?? (reached && advancesOnSend(lead.status) ? "Contacted" : undefined);
    const remark = { text: input.text, channel: input.channel, status, at: new Date(), by: auth.session.userId, byName: auth.session.name || undefined };

    await SalesLead.updateOne({ _id: id }, {
      $push: { remarks: remark },
      $set: {
        updatedBy: auth.session.userId, ...(status ? { status } : {}), ...(reached ? { lastContactedAt: remark.at } : {}),
        ...(next?.followUpAt ? { followUpAt: next.followUpAt, followUpNote: next.followUpNote || undefined } : {})
      },
      ...(next && !next.followUpAt ? { $unset: { followUpAt: "", followUpNote: "" } } : {}),
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

/**
 * Sets, moves or clears the next follow-up without writing a remark — "move it
 * to Monday" from the dashboard is one tap, not a conversation to log.
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    const scope = leadScope(auth.session);
    if (!scope || (!isExecutive(auth.session) && !can.manageSalesTeam(auth.session.role))) return badRequest("You do not have access to this action", 403);
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Unknown lead");
    await connectDb();

    const input = followUpSchema.parse(await request.json());
    const result = await SalesLead.updateOne({ _id: id, ...scope }, input.followUpAt
      ? { $set: { followUpAt: input.followUpAt, followUpNote: input.followUpNote || undefined, updatedBy: auth.session.userId } }
      : { $unset: { followUpAt: "", followUpNote: "" }, $set: { updatedBy: auth.session.userId } });
    if (!result.matchedCount) return badRequest("That lead is not in your list", 404);

    await record({ actor: auth.session.userId, action: "team.lead.followup", entityType: "SalesLead", entityId: id, metadata: input });
    return ok({ followUpAt: input.followUpAt });
  } catch (error) {
    return fail(error);
  }
}
