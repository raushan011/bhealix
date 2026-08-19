import { connectDb } from "@/lib/db/mongoose";
import { SalesLead } from "@/models/Sales";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { fail, ok } from "@/lib/api";
import { record } from "@/lib/audit";
import { bulkLeadSchema, canonicalType } from "@/lib/sales/leads";

/**
 * The same change to everything that was ticked.
 *
 * Working a sweep means doing one thing to forty rows — the whole batch from
 * Sector 62 turned out to be closed, the trade was filed under the wrong word
 * when it was saved. One dropdown at a time is forty round trips, and what
 * people do instead of forty round trips is nothing, which leaves the filters
 * lying about the state of the list.
 *
 * `POST` with the action named in the body rather than a `PATCH` and a
 * `DELETE`: the screen sends the same tick-boxes either way, and one route is
 * one place where the id list is checked and the trail is written.
 *
 * The trail records the batch, not the rows. Forty audit lines for one press of
 * one button buries every other action of the day in a screen nobody can then
 * read (§4.8) — so one line, carrying the count and what was done.
 */
export async function POST(request: Request) {
  try {
    const auth = await apiSession(can.manageSales);
    if ("response" in auth) return auth.response;
    await connectDb();

    const input = bulkLeadSchema.parse(await request.json());
    const where = { _id: { $in: input.ids } };

    if (input.action === "delete") {
      /**
       * The names are read before the delete, not after — there is no after.
       * A batch removed by mistake is answered by "which forty were they", and
       * the ids on the trail answer that for nobody. Capped at the first
       * twenty so one careless sweep cannot write a novel into the trail.
       */
      const going = await SalesLead.find(where).select("name").limit(20).lean() as unknown as { name: string }[];
      const result = await SalesLead.deleteMany(where);

      await record({
        actor: auth.session.userId,
        action: "sales.leads.bulk-deleted",
        entityType: "SalesLead",
        // A batch, not a document — an id here fails the ObjectId cast and the
        // line is lost silently (§11).
        entityId: undefined,
        metadata: { count: result.deletedCount, names: going.map(lead => lead.name) }
      });

      return ok({ deleted: result.deletedCount });
    }

    const change = input.action === "status"
      ? { status: input.status }
      // Case-blind against what is already saved, so a bulk re-file cannot
      // open a near-duplicate entry in the type filter.
      : { type: canonicalType(input.type ?? "", await SalesLead.distinct("type") as string[]) };
    const result = await SalesLead.updateMany(where, { $set: { ...change, updatedBy: auth.session.userId } });

    await record({
      actor: auth.session.userId,
      action: "sales.leads.bulk-updated",
      entityType: "SalesLead",
      entityId: undefined,
      metadata: { count: result.modifiedCount, ...change }
    });

    return ok({ updated: result.modifiedCount });
  } catch (error) {
    return fail(error);
  }
}
