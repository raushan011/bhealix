import { connectDb } from "@/lib/db/mongoose";
import { SalesLead } from "@/models/Sales";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok } from "@/lib/api";
import { record } from "@/lib/audit";
import { canonicalType, typeMatches, typeRenameSchema } from "@/lib/sales/leads";

/**
 * Renaming a type wholesale: every lead filed under one word moves to another.
 *
 * The type is typed by hand at the moment of searching, so the filter grows
 * near-duplicates — "Beauty parlour", "Beauty parlour Bulandshahar", "Beauty
 * Parlour Ghaziabad" — and each one splits the list it belongs to. Fixing that
 * by hand means paging through hundreds of rows fifty at a time; this is one
 * request that moves them all.
 *
 * The match on `from` is case-blind and space-blind, so renaming "beauty
 * parlour" also collects "Beauty  Parlour". The target is canonicalised
 * against what already exists, which is what makes a rename into an existing
 * type a *merge*: rename "Beauty Parlour Ghaziabad" to "Beauty parlour" and
 * the filter afterwards has one entry where there were two. The city was
 * never lost — every lead still carries its own `city` field, which is what
 * the search filter reads.
 */
export async function PATCH(request: Request) {
  try {
    const auth = await apiSession(can.manageSales);
    if ("response" in auth) return auth.response;
    await connectDb();

    const input = typeRenameSchema.parse(await request.json());
    const existing = await SalesLead.distinct("type") as string[];

    /*
     * The target is canonicalised against every type *except* the one being
     * renamed. Against all of them, fixing a capitalisation — "beauty
     * parlour" to "Beauty parlour" — would match the old spelling case-blind
     * and hand it straight back, and the rename would change nothing.
     * Against the others, a merge into a genuinely different type still
     * adopts that type's stored spelling, which is what keeps the filter at
     * one entry per trade.
     */
    const fold = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
    const others = existing.filter(candidate => fold(candidate) !== fold(input.from));
    const to = canonicalType(input.to, others);
    const where = typeMatches(input.from);

    if (to === input.from.trim()) return badRequest("That is already the type's name.");

    const result = await SalesLead.updateMany(where, { $set: { type: to, updatedBy: auth.session.userId } });
    if (!result.matchedCount) return badRequest("No lead is filed under that type any more.", 404);

    await record({
      actor: auth.session.userId,
      action: "sales.leads.type-renamed",
      entityType: "SalesLead",
      // A batch, not a document — an id here fails the ObjectId cast (§11).
      entityId: undefined,
      metadata: { from: input.from, to, count: result.modifiedCount }
    });

    return ok({ renamed: result.modifiedCount, to });
  } catch (error) {
    return fail(error);
  }
}
