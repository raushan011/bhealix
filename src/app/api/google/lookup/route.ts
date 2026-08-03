import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok } from "@/lib/api";
import { lookupSchema, type DiscoveredDoctor } from "@/lib/doctors/discovery";
import { searchText, toDiscovered } from "@/lib/doctors/places";

/**
 * Finds a specific doctor or clinic by name.
 *
 * Unlike area discovery this makes a single Places call with no radius sweep,
 * so it is cheap and quick — the intended use is adding one doctor you already
 * know about rather than surveying a neighbourhood.
 */
export async function POST(request: Request) {
  try {
    const auth = await apiSession(can.manageDoctors);
    if ("response" in auth) return auth.response;

    const key = process.env.GOOGLE_MAPS_SERVER_API_KEY;
    if (!key) return badRequest("Google Maps server API key is not configured", 503);

    const { query, near } = lookupSchema.parse(await request.json());
    const places = await searchText(near ? `${query} ${near}` : query, key, { pages: 1 });

    const items = places
      .map(place => toDiscovered(place, "Dermatologist"))
      .filter((item): item is DiscoveredDoctor => item !== null);

    return ok({ items });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Google")) return badRequest(error.message);
    return fail(error);
  }
}
