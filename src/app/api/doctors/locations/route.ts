import { unstable_cache } from "next/cache";
import { connectDb } from "@/lib/db/mongoose";
import { Doctor } from "@/models/Doctor";
import { apiSession } from "@/lib/auth/guard";
import { fail, ok } from "@/lib/api";
import type { DoctorLocation } from "@/lib/doctors/fields";

/**
 * The places doctors are actually recorded in, for the directory's filter.
 *
 * Read off the data rather than kept as a list somebody maintains, because
 * these arrive from Google imports and manual entry and would drift within a
 * week of being hardcoded.
 *
 * A doctor counts towards both its area and its city, so either can be picked;
 * `$setDifference` drops blanks and collapses the two when they are the same
 * word. Each entry also carries how many of its doctors have no call time, so
 * the filter can be aimed at the gap without hunting for it.
 */
async function readLocations() {
  await connectDb();
  return Doctor.aggregate<DoctorLocation>([
    { $match: { status: "Active" } },
    {
      $project: {
        places: { $setDifference: [["$area", "$city"], [null, ""]] },
        missing: { $eq: [{ $size: { $ifNull: ["$callSchedule", []] } }, 0] }
      }
    },
    { $unwind: "$places" },
    {
      $group: {
        _id: "$places",
        total: { $sum: 1 },
        missingCallTime: { $sum: { $cond: ["$missing", 1, 0] } }
      }
    },
    { $project: { _id: 0, name: "$_id", total: 1, missingCallTime: 1 } },
    { $sort: { name: 1 } }
  ]);
}

/**
 * Held for a minute, because this reads the entire active directory.
 *
 * There is no `$match` narrow enough to index here — answering "which places
 * exist" means visiting every doctor, unwinding two fields off each and
 * grouping the result. That is a fine query to run occasionally and a poor one
 * to run on every load of the busiest screen in the app, which is what it was
 * doing: the directory fires it alongside the list on mount, so it cost a full
 * pass over the collection for a dropdown nobody had opened yet.
 *
 * A minute rather than a tag invalidated by the doctor routes. The answer is a
 * list of area names with counts beside them, and there are eight places that
 * write a doctor — bulk import, manual entry, the Google lookup, a visit
 * outcome, an invoice's party details. Wiring all of them for a filter that is
 * an aid rather than a source of truth buys correctness nobody would notice at
 * the price of a tag one of them will eventually forget. A new area appears in
 * the list within the minute; nothing depends on it being there sooner.
 *
 * No session is read inside, and none may be — the result is shared by every
 * caller, and this list is the same for all of them. The guard stays outside.
 */
const cachedLocations = unstable_cache(readLocations, ["doctor-locations"], { revalidate: 60 });

export async function GET() {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;

    return ok({ items: await cachedLocations() });
  } catch (error) {
    return fail(error);
  }
}
