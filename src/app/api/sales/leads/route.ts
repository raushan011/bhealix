import { connectDb } from "@/lib/db/mongoose";
import { SalesLead } from "@/models/Sales";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { fail, ok, pageParams } from "@/lib/api";
import { record } from "@/lib/audit";
import { leadSaveSchema, leadWhere, toLeadFields, withLeadStatus } from "@/lib/sales/leads";
import { drainQueue, queueLeads, type DrainReport, type QueueReport } from "@/lib/sales/outreach-engine";

/**
 * The saved list, filtered the way somebody working through it asks about it:
 * this trade, this state, this half-remembered name.
 */
export async function GET(request: Request) {
  try {
    const auth = await apiSession(can.viewSales);
    if ("response" in auth) return auth.response;
    await connectDb();

    const { page, limit, skip } = pageParams(request.url);
    const params = new URL(request.url).searchParams;

    // The status counts below are what the filter options are labelled with, so
    // they are taken before the status filter narrows anything — otherwise
    // picking "Contacted" would report every other state as zero.
    const unfiltered = leadWhere(params);
    const withStatus = withLeadStatus(unfiltered, params.get("status"));

    /**
     * The outreach queue's one extra question: leave out anybody already
     * messaged. Asked as its own filter rather than folded into `status`
     * because the two genuinely differ — a lead messaged last week and marked
     * `Interested` since is not one to message again, and neither is one still
     * sitting at `New` because nobody replied.
     */
    const where = params.get("contacted") === "never"
      ? { ...withStatus, lastContactedAt: { $exists: false } }
      : withStatus;

    /**
     * Newest-first for the list somebody is reading; least-recently-messaged
     * first for the queue somebody is working. Mongo sorts missing values ahead
     * of present ones on an ascending sort, which is exactly the order wanted —
     * everyone never contacted, then the coldest of the rest.
     */
    const order: Record<string, 1 | -1> = params.get("sort") === "outreach"
      ? { lastContactedAt: 1, createdAt: -1 }
      : { createdAt: -1 };

    const [items, total, counts, types] = await Promise.all([
      SalesLead.find(where).sort(order).skip(skip).limit(limit).lean(),
      SalesLead.countDocuments(where),
      SalesLead.aggregate([{ $match: unfiltered }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
      // Every trade ever saved, so the filter offers what is actually there
      // rather than the suggestions the search screen happens to ship with.
      SalesLead.distinct("type")
    ]);

    return ok({
      items,
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
      counts: Object.fromEntries(counts.map((row: { _id: string; count: number }) => [row._id, row.count])),
      types: (types as string[]).sort((a, b) => a.localeCompare(b))
    });
  } catch (error) {
    return fail(error);
  }
}

/**
 * Keeps the results somebody picked out of a search.
 *
 * Upserts on Google's place id rather than inserting, so sweeping the same area
 * again a month later refreshes the twenty parlours already held instead of
 * filing them twice. What a search knows is overwritten — the name, the phone
 * number, the rating; what a person knows is not. `status`, `notes` and any
 * corrected `type` survive a re-sweep, because they are the work, and the row
 * underneath them is only what Google said that day.
 */
export async function POST(request: Request) {
  try {
    const auth = await apiSession(can.manageSales);
    if ("response" in auth) return auth.response;
    await connectDb();

    const input = leadSaveSchema.parse(await request.json());
    const context = {
      searchQuery: input.searchQuery,
      searchLocation: input.searchLocation,
      updatedBy: auth.session.userId
    };

    const rows = input.leads.map(toLeadFields);
    const known = rows.filter(row => row.googlePlaceId);
    const unknown = rows.filter(row => !row.googlePlaceId);

    const result = known.length
      ? await SalesLead.bulkWrite(known.map(({ googlePlaceId, type, ...lead }) => ({
        updateOne: {
          filter: { googlePlaceId },
          update: {
            $set: { ...lead, ...context },
            $setOnInsert: {
              googlePlaceId,
              type,
              status: "New",
              source: "Google",
              createdBy: auth.session.userId
            }
          },
          upsert: true
        }
      })))
      : null;

    const typed = unknown.length
      ? await SalesLead.insertMany(unknown.map(lead => ({
        ...lead,
        // Left off rather than stored empty: the place-id index is unique and
        // sparse, and a second hand-typed lead carrying a null would collide
        // with the first one.
        googlePlaceId: undefined,
        ...context,
        source: "Manual",
        createdBy: auth.session.userId
      })))
      : [];

    const created = (result?.upsertedCount ?? 0) + typed.length;
    const updated = result?.matchedCount ?? 0;

    /*
     * The automation, if it is switched on: every row this save touched is
     * offered to the rules, and whatever they queue goes out now, in this same
     * request. Failures are swallowed into the response rather than raised —
     * the leads *are* saved, and a Meta outage must not turn a successful save
     * into an error screen. The panel shows what was queued and what went.
     */
    let automation: { queued: QueueReport; drained: DrainReport | null } | undefined;
    try {
      const ids = [
        ...Object.values(result?.upsertedIds ?? {}).map(String),
        ...known.length && result ? await SalesLead.find({ googlePlaceId: { $in: known.map(row => row.googlePlaceId) } }).distinct("_id").then(found => found.map(String)) : [],
        ...typed.map(doc => String(doc._id))
      ];
      const queued = await queueLeads([...new Set(ids)], "Saved");
      const drained = queued.queued ? await drainQueue({ trigger: "Saved" }) : null;
      automation = { queued, drained };
    } catch (problem) {
      console.error("Automation after save failed", problem);
    }

    await record({
      actor: auth.session.userId,
      action: "sales.leads.saved",
      entityType: "SalesLead",
      // A batch, not a document. `entityId` is an ObjectId on the trail, and a
      // word in its place fails the cast and loses the line silently.
      entityId: undefined,
      metadata: {
        created,
        updated,
        type: input.leads[0]?.type,
        query: input.searchQuery,
        location: input.searchLocation
      }
    });

    return ok({ created, updated, automation }, 201);
  } catch (error) {
    return fail(error);
  }
}
