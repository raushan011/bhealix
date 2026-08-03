import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok } from "@/lib/api";
import { discoverySchema, type DiscoveredDoctor } from "@/lib/doctors/discovery";
import { geocode, searchText, toDiscovered, type Centre } from "@/lib/doctors/places";
import { haversineKm } from "@/lib/routing";

type Cached = { expires: number; payload: unknown };
const cache = globalThis as typeof globalThis & { discoveryCache?: Map<string, Cached> };
cache.discoveryCache ??= new Map();

/**
 * One Places call only returns about 20 results near a single point, so a wide
 * radius is covered by searching a ring of sub-centres and merging by Place ID.
 * Each centre yields up to 40 results across two pages.
 */
function searchCentres(origin: Centre, radiusKm: number, target: number): Centre[] {
  const zones = Math.min(16, Math.max(1, Math.ceil(target / 40)));
  if (zones === 1 || radiusKm <= 3) return [origin];

  const centres: Centre[] = [origin];
  const kmPerLng = 111 * Math.max(0.2, Math.cos(origin.lat * Math.PI / 180));
  for (let i = 0; i < zones - 1; i++) {
    const angle = (2 * Math.PI * i) / (zones - 1);
    const ring = radiusKm * (i % 2 === 0 ? 0.65 : 0.35);
    centres.push({
      lat: origin.lat + (Math.cos(angle) * ring) / 111,
      lng: origin.lng + (Math.sin(angle) * ring) / kmPerLng
    });
  }
  return centres;
}

export async function POST(request: Request) {
  try {
    const auth = await apiSession(can.manageDoctors);
    if ("response" in auth) return auth.response;

    const key = process.env.GOOGLE_MAPS_SERVER_API_KEY;
    if (!key) return badRequest("Google Maps server API key is not configured", 503);

    const input = discoverySchema.parse(await request.json());
    const cacheKey = JSON.stringify(input).toLowerCase();
    const hit = cache.discoveryCache?.get(cacheKey);
    if (hit && hit.expires > Date.now()) return ok({ ...(hit.payload as object), cached: true });

    const origin = await geocode(input.location, key);
    const centres = searchCentres(origin, input.radiusKm, input.resultLimit);
    const zoneRadiusM = Math.min(50000, Math.max(1000, (input.radiusKm * 1000) / Math.sqrt(centres.length)));

    const found = new Map<string, DiscoveredDoctor>();
    let apiCalls = 0;

    outer: for (const term of input.doctorTypes) {
      for (const centre of centres) {
        const places = await searchText(`${term} in ${input.location}`, key, {
          bias: { centre, radiusM: zoneRadiusM },
          pages: 2
        });
        apiCalls++;

        for (const place of places) {
          if (!place.location || found.has(place.id)) continue;
          const distanceKm = haversineKm(
            { latitude: origin.lat, longitude: origin.lng },
            { latitude: place.location.latitude, longitude: place.location.longitude }
          );
          if (distanceKm > input.radiusKm) continue;
          const doctor = toDiscovered(place, term, distanceKm);
          if (doctor) found.set(place.id, doctor);
          if (found.size >= input.resultLimit) break outer;
        }
      }
    }

    const payload = {
      items: [...found.values()].sort((a, b) => a.distanceKm - b.distanceKm),
      searchedZones: centres.length,
      apiCalls
    };
    cache.discoveryCache?.set(cacheKey, { expires: Date.now() + 10 * 60 * 1000, payload });
    return ok({ ...payload, cached: false });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Google")) return badRequest(error.message);
    return fail(error);
  }
}
