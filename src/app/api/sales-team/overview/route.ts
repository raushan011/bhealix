import { Types } from "mongoose";
import { connectDb } from "@/lib/db/mongoose";
import { SalesLead } from "@/models/Sales";
import { apiSession } from "@/lib/auth/guard";
import { badRequest, fail, ok } from "@/lib/api";
import { dayRange, shiftDay, todayIso } from "@/lib/time";
import { isExecutive, orderScope } from "@/lib/sales-team/access";
import { executiveSummaries, loadTeamSettings, totalOf } from "@/lib/sales-team/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The sales team at a glance, for a date range (the last thirty days unless
 * asked otherwise): orders placed, what was delivered, what came back, revenue,
 * and each executive's incentive — earned, owed and paid — with the leads they
 * were handed and how many they turned into orders.
 *
 * Asked by the Sales CRM for everybody and by an executive for themselves; the
 * scope decides which, never a parameter.
 */
export async function GET(request: Request) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    const scope = orderScope(auth.session);
    if (!scope) return badRequest("You do not have access to the sales team", 403);
    await connectDb();

    const params = new URL(request.url).searchParams;
    const to = params.get("to") || todayIso();
    const from = params.get("from") || shiftDay(to, -29);
    const placedAt = dayRange(from, to);
    const own = isExecutive(auth.session) ? auth.session.userId : undefined;

    const [summaries, leadRows, settings] = await Promise.all([
      executiveSummaries({ ...scope, ...(placedAt ? { placedAt } : {}) }, own),
      SalesLead.aggregate([
        { $match: { assignedTo: own ? new Types.ObjectId(own) : { $ne: null } } },
        {
          $group: {
            _id: "$assignedTo",
            assigned: { $sum: 1 },
            converted: { $sum: { $cond: [{ $eq: ["$status", "Converted"] }, 1, 0] } },
            fresh: { $sum: { $cond: [{ $eq: ["$status", "New"] }, 1, 0] } },
            interested: { $sum: { $cond: [{ $eq: ["$status", "Interested"] }, 1, 0] } }
          }
        }
      ]) as Promise<Array<{ _id: Types.ObjectId; assigned: number; converted: number; fresh: number; interested: number }>>,
      loadTeamSettings()
    ]);

    const leads = new Map(leadRows.map(row => [String(row._id), row]));
    const rows = summaries
      .filter(row => own || row.orders || row.executive.active)
      .map(row => {
        const lead = leads.get(row.executive._id);
        return { ...row, leads: { assigned: lead?.assigned ?? 0, converted: lead?.converted ?? 0, fresh: lead?.fresh ?? 0, interested: lead?.interested ?? 0 } };
      })
      .sort((left, right) => right.revenue - left.revenue || left.executive.name.localeCompare(right.executive.name));

    return ok({
      from, to,
      totals: totalOf(rows),
      executives: rows,
      unassignedLeads: own ? undefined : await SalesLead.countDocuments({ assignedTo: null, status: { $nin: ["Converted", "Not interested"] } }),
      rules: settings.incentiveRules,
      lastSync: settings.lastShipmentSyncAt ?? null,
      lastSyncError: settings.lastShipmentSyncError ?? null
    });
  } catch (error) {
    return fail(error);
  }
}
