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
export async function GET() {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    await connectDb();

    const items = await Doctor.aggregate<DoctorLocation>([
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

    return ok({ items });
  } catch (error) {
    return fail(error);
  }
}
