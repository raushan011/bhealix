import { Types } from "mongoose";
import { connectDb } from "@/lib/db/mongoose";
import { SalesLead } from "@/models/Sales";
import { apiSession } from "@/lib/auth/guard";
import { badRequest, fail, ok, OBJECT_ID, pageParams } from "@/lib/api";
import { LEAD_STATUSES, like } from "@/lib/sales/leads";
import { todayIso } from "@/lib/time";
import { isExecutive, leadScope } from "@/lib/sales-team/access";
import { can } from "@/constants/access";
import { record } from "@/lib/audit";
import { tenDigitPhone } from "@/lib/sales/fulfilment";
import { ownLeadSchema } from "@/lib/sales-team/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FIELDS = "name type status phone website address area city googleMapsUrl rating notes assignedTo assignedAt "
  + "lastContactedAt contactCount convertedAt followUpAt followUpNote source updatedAt createdAt";

/**
 * Leads as the sales team sees them.
 *
 * For an executive: the leads handed to them, to be worked — fresh ones first,
 * then the ones that have gone longest without a word. For the desk: every lead,
 * filterable by whom it is with (`assigned` = an executive's id, `none` or
 * `any`), which is the list the assignment screen hands out from.
 *
 * `counts` are taken before the status filter, so the status tabs show real
 * numbers whichever one is open.
 */
export async function GET(request: Request) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    const scope = leadScope(auth.session);
    if (!scope) return badRequest("You do not have access to the sales team's leads", 403);
    await connectDb();

    const { page, limit, skip, q } = pageParams(request.url);
    const params = new URL(request.url).searchParams;
    const and: Record<string, unknown>[] = [scope];

    if (!isExecutive(auth.session)) {
      const assigned = params.get("assigned");
      if (assigned === "none") and.push({ assignedTo: null });
      else if (assigned === "any") and.push({ assignedTo: { $ne: null } });
      else if (assigned && OBJECT_ID.test(assigned)) and.push({ assignedTo: new Types.ObjectId(assigned) });
    }
    switch (params.get("followUp")) {
      case "due": and.push({ followUpAt: { $lte: todayIso() } }); break;
      case "any": and.push({ followUpAt: { $nin: [null, ""] } }); break;
    }
    const type = params.get("type");
    if (type) and.push({ type });
    const city = params.get("city");
    if (city) and.push({ city: like(city) });
    if (q) {
      const pattern = like(q);
      and.push({ $or: [{ name: pattern }, { phone: pattern }, { address: pattern }, { area: pattern }, { city: pattern }] });
    }

    const unfiltered = { $and: and };
    const status = params.get("status");
    const filter = status && (LEAD_STATUSES as readonly string[]).includes(status)
      ? { $and: [...and, { status }] }
      : params.get("open") === "1" ? { $and: [...and, { status: { $nin: ["Converted", "Not interested"] } }] } : unfiltered;

    const [items, total, counts, types] = await Promise.all([
      SalesLead.find(filter).select(FIELDS).populate("assignedTo", "name")
        // Untouched first, then whoever has waited longest since the last word.
        .sort(isExecutive(auth.session) ? { lastContactedAt: 1, assignedAt: -1, _id: 1 } : { createdAt: -1, _id: 1 })
        .skip(skip).limit(limit).lean(),
      SalesLead.countDocuments(filter),
      SalesLead.aggregate([{ $match: unfiltered }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
      SalesLead.distinct("type", scope)
    ]);

    return ok({
      items, total, page, pages: Math.max(1, Math.ceil(total / limit)),
      counts: Object.fromEntries((counts as Array<{ _id: string; count: number }>).map(row => [row._id, row.count])),
      types: (types as string[]).filter(Boolean).sort()
    });
  } catch (error) {
    return fail(error);
  }
}

/**
 * A customer the executive found themselves — a referral, a walk-in, somebody
 * who rang the number on a parcel — added to their own list so the follow-up is
 * kept. Assigned to whoever adds it.
 *
 * A phone number already in that executive's list is not added twice; the
 * existing lead is returned with the new follow-up applied, because two rows
 * for one customer is how a call gets made twice and a remark gets lost.
 */
export async function POST(request: Request) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    if (!isExecutive(auth.session) && !can.manageSalesTeam(auth.session.role)) return badRequest("You do not have access to this action", 403);
    await connectDb();

    const input = ownLeadSchema.parse(await request.json());
    const digits = tenDigitPhone(input.phone);
    if (!digits) return badRequest("Enter a 10-digit mobile number.");

    const followUp = input.followUpAt ? { followUpAt: input.followUpAt, followUpNote: input.followUpNote || undefined } : {};
    const existing = await SalesLead.findOne({ assignedTo: auth.session.userId, phone: { $regex: `${digits}$` } }).select("_id name").lean() as { _id: unknown; name: string } | null;
    if (existing) {
      if (input.followUpAt) await SalesLead.updateOne({ _id: existing._id }, { $set: { ...followUp, updatedBy: auth.session.userId } });
      return ok({ _id: existing._id, existed: true, message: `${existing.name} is already in your list${input.followUpAt ? " — the follow-up was updated" : ""}.` });
    }

    const lead = await SalesLead.create({
      name: input.name, phone: digits, city: input.city || undefined, address: input.address || undefined,
      type: input.type || "Customer", notes: input.notes || undefined, source: "Manual", status: "New",
      assignedTo: auth.session.userId, assignedAt: new Date(), assignedBy: auth.session.userId,
      createdBy: auth.session.userId, updatedBy: auth.session.userId, ...followUp,
      remarks: input.notes ? [{ text: input.notes, channel: "Note", at: new Date(), by: auth.session.userId, byName: auth.session.name || undefined }] : []
    });
    await record({ actor: auth.session.userId, action: "team.lead.added", entityType: "SalesLead", entityId: lead._id, metadata: { name: input.name, followUpAt: input.followUpAt } });
    return ok({ _id: lead._id, existed: false, message: `${input.name} added to your list.` }, 201);
  } catch (error) {
    return fail(error);
  }
}
