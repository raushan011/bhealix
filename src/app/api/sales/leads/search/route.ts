import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok } from "@/lib/api";
import { geocode, searchText } from "@/lib/doctors/places";
import { leadSearchPages, leadSearchSchema, toLead, type DiscoveredLead } from "@/lib/sales/leads";

type Cached = { expires: number; payload: unknown };
const cache = globalThis as typeof globalThis & { leadSearchCache?: Map<string, Cached> };
cache.leadSearchCache ??= new Map();

/**
 * One search of Google Places, for whatever trade the office is working today.
 *
 * Writes nothing. Searching is spending — every page is a billed request — and
 * what comes back is a hundred shopfronts of which perhaps twenty are worth
 * keeping. Saving is a second, deliberate step (`POST /api/sales/leads`), so
 * the list on screen is a proposal rather than a fait accompli.
 *
 * Repeating the same search inside ten minutes is answered from memory for the
 * same reason: pressing Search twice because the first press was not obviously
 * doing anything should not cost twice.
 *
 * Guarded by `manageSales` rather than `viewSales`: reading the affiliate
 * operation is one thing, and running up a bill against the company's Google
 * quota is another.
 */
export async function POST(request: Request) {
  try {
    const auth = await apiSession(can.manageSales);
    if ("response" in auth) return auth.response;

    const key = process.env.GOOGLE_MAPS_SERVER_API_KEY;
    if (!key) {
      return badRequest("Google Maps server API key is not configured, so nothing can be searched for yet.", 503);
    }

    const input = leadSearchSchema.parse(await request.json());
    const cacheKey = JSON.stringify(input).toLowerCase();
    const hit = cache.leadSearchCache?.get(cacheKey);
    if (hit && hit.expires > Date.now()) return ok({ ...(hit.payload as object), cached: true });

    /*
     * The location is geocoded and used only to bias the search, never to
     * filter it. Google reads "beauty parlour in Ghaziabad" perfectly well on
     * its own; the bias is what keeps a common name from drifting to a bigger
     * city three states away. There is no radius to enforce here — the doctor
     * sweep next door has one because a route has to be drivable, and a list of
     * numbers to ring does not.
     */
    const centre = await geocode(input.location, key);
    const pages = leadSearchPages(input.resultLimit);
    const places = await searchText(`${input.query} in ${input.location}`, key, {
      bias: { centre, radiusM: 25000 },
      pages
    });

    const found = new Map<string, DiscoveredLead>();
    for (const place of places) {
      if (found.size >= input.resultLimit) break;
      const lead = toLead(place, input.type);
      if (lead && !found.has(lead.placeId)) found.set(lead.placeId, lead);
    }

    const payload = { items: [...found.values()], apiCalls: pages };
    cache.leadSearchCache?.set(cacheKey, { expires: Date.now() + 10 * 60 * 1000, payload });
    return ok({ ...payload, cached: false });
  } catch (error) {
    // `geocode` throws with Google's own name in the sentence when it cannot
    // place the location — that is the user's problem to fix, not a fault.
    if (error instanceof Error && error.message.startsWith("Google")) return badRequest(error.message);
    return fail(error);
  }
}
