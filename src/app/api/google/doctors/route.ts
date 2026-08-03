import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok } from "@/lib/api";
import { discoverySchema, type DiscoveredDoctor } from "@/lib/doctors/discovery";
import { haversineKm } from "@/lib/routing";

type Place = {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  shortFormattedAddress?: string;
  location?: { latitude: number; longitude: number };
  rating?: number;
  userRatingCount?: number;
  nationalPhoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  addressComponents?: Array<{ longText?: string; types?: string[] }>;
};

const FIELD_MASK = [
  "places.id", "places.displayName", "places.formattedAddress", "places.shortFormattedAddress",
  "places.location", "places.rating", "places.userRatingCount", "places.nationalPhoneNumber",
  "places.websiteUri", "places.googleMapsUri", "places.addressComponents", "nextPageToken"
].join(",");

type Centre = { lat: number; lng: number };
type Cached = { expires: number; payload: unknown };
const cache = globalThis as typeof globalThis & { discoveryCache?: Map<string, Cached> };
cache.discoveryCache ??= new Map();

async function geocode(location: string, key: string): Promise<Centre> {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", location);
  url.searchParams.set("key", key);
  const data = await fetch(url, { cache: "no-store" }).then(r => r.json()) as
    { status: string; results?: Array<{ geometry: { location: Centre } }> };
  if (data.status !== "OK" || !data.results?.[0]) throw new Error(`Google could not find "${location}"`);
  return data.results[0].geometry.location;
}

/**
 * One Places call only returns ~20 results near a single point, so a wide radius
 * is covered by searching a ring of sub-centres and merging by Place ID.
 */
function searchCentres(origin: Centre, radiusKm: number, target: number): Centre[] {
  const zones = Math.min(13, Math.max(1, Math.ceil(target / 40)));
  if (zones === 1 || radiusKm <= 3) return [origin];
  const centres: Centre[] = [origin];
  const kmPerLng = 111 * Math.max(0.2, Math.cos(origin.lat * Math.PI / 180));
  for (let i = 0; i < zones - 1; i++) {
    const angle = (2 * Math.PI * i) / (zones - 1);
    const ring = radiusKm * (i % 2 === 0 ? 0.65 : 0.35);
    centres.push({ lat: origin.lat + (Math.cos(angle) * ring) / 111, lng: origin.lng + (Math.sin(angle) * ring) / kmPerLng });
  }
  return centres;
}

async function searchZone(term: string, centre: Centre, radiusM: number, key: string) {
  const places: Place[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 2; page++) {
    const body: Record<string, unknown> = {
      textQuery: term,
      pageSize: 20,
      locationBias: { circle: { center: { latitude: centre.lat, longitude: centre.lng }, radius: radiusM } }
    };
    if (pageToken) body.pageToken = pageToken;
    const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": FIELD_MASK },
      body: JSON.stringify(body),
      cache: "no-store"
    });
    if (!response.ok) throw new Error(`Google Places rejected the request (${response.status})`);
    const data = await response.json() as { places?: Place[]; nextPageToken?: string };
    places.push(...(data.places ?? []));
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return places;
}

const component = (place: Place, type: string) =>
  place.addressComponents?.find(c => c.types?.includes(type))?.longText ?? "";

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
        const places = await searchZone(`${term} in ${input.location}`, centre, zoneRadiusM, key);
        apiCalls++;
        for (const place of places) {
          if (!place.location || found.has(place.id)) continue;
          const distanceKm = haversineKm(
            { latitude: origin.lat, longitude: origin.lng },
            { latitude: place.location.latitude, longitude: place.location.longitude }
          );
          if (distanceKm > input.radiusKm) continue;
          found.set(place.id, {
            placeId: place.id,
            name: place.displayName?.text ?? "Unnamed clinic",
            doctorType: term,
            address: place.formattedAddress ?? place.shortFormattedAddress ?? "",
            area: component(place, "sublocality_level_1") || component(place, "sublocality") || component(place, "neighborhood"),
            city: component(place, "locality") || component(place, "administrative_area_level_2"),
            phone: place.nationalPhoneNumber ?? "",
            website: place.websiteUri ?? "",
            mapsUrl: place.googleMapsUri ?? "",
            rating: place.rating,
            reviewCount: place.userRatingCount,
            latitude: place.location.latitude,
            longitude: place.location.longitude,
            distanceKm: Number(distanceKm.toFixed(1))
          });
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
