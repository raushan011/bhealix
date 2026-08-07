import { apiSession } from "@/lib/auth/guard";
import { badRequest, fail, ok } from "@/lib/api";
import { isLatitude, isLongitude } from "@/lib/geo";
import { reverseGeocode } from "@/lib/doctors/places";

/**
 * Puts a street address to a pair of coordinates.
 *
 * Called from a rep's phone while a visit photo is being stamped, so it is open
 * to anyone signed in — it reveals nothing beyond what the caller already sent
 * and answers about where they are standing.
 *
 * Every failure comes back as a 200 with no address rather than an error. The
 * caller is mid-upload and the address is decoration on top of the coordinates;
 * a Google outage must slow nothing down and stop nothing happening.
 */
export async function GET(request: Request) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;

    const params = new URL(request.url).searchParams;
    const latitude = Number(params.get("lat"));
    const longitude = Number(params.get("lng"));
    if (!isLatitude(latitude) || !isLongitude(longitude)) return badRequest("Invalid coordinates");

    const key = process.env.GOOGLE_MAPS_SERVER_API_KEY;
    if (!key) return ok({ address: "", area: "", city: "" });

    const place = await reverseGeocode(latitude, longitude, key).catch(() => null);
    return ok(place ?? { address: "", area: "", city: "" });
  } catch (error) {
    return fail(error);
  }
}
