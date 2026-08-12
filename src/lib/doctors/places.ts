import type { DiscoveredDoctor } from "./discovery";

export type Place = {
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

export type Centre = { lat: number; lng: number };

export async function geocode(location: string, key: string): Promise<Centre> {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", location);
  url.searchParams.set("key", key);
  const data = await fetch(url, { cache: "no-store" }).then(r => r.json()) as
    { status: string; results?: Array<{ geometry: { location: Centre } }> };
  if (data.status !== "OK" || !data.results?.[0]) throw new Error(`Google could not find "${location}"`);
  return data.results[0].geometry.location;
}

type GeocodeResult = {
  formatted_address?: string;
  address_components?: Array<{ long_name?: string; types?: string[] }>;
};

export type PlaceName = { address: string; area: string; city: string };

/**
 * The street address a pair of coordinates sits at.
 *
 * Used to caption a visit photo, so it returns null rather than throwing when
 * Google is unreachable or has nothing for the point: the coordinates are the
 * proof of where the rep stood, and the address is only there to make them
 * readable. Losing the wording must never cost the photo.
 */
export async function reverseGeocode(
  latitude: number, longitude: number, key: string
): Promise<PlaceName | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("latlng", `${latitude},${longitude}`);
  url.searchParams.set("key", key);

  const data = await fetch(url, { cache: "no-store" }).then(r => r.json()) as
    { status?: string; results?: GeocodeResult[] };
  const first = data.status === "OK" ? data.results?.[0] : undefined;
  if (!first?.formatted_address) return null;

  const part = (type: string) =>
    first.address_components?.find(c => c.types?.includes(type))?.long_name ?? "";

  return {
    address: first.formatted_address,
    area: part("sublocality_level_1") || part("sublocality") || part("neighborhood"),
    city: part("locality") || part("administrative_area_level_2")
  };
}

/** One Places text search. `pages` of 20 results each; bias is optional. */
export async function searchText(query: string, key: string, options: {
  bias?: { centre: Centre; radiusM: number };
  pages?: number;
} = {}): Promise<Place[]> {
  const places: Place[] = [];
  let pageToken: string | undefined;
  const pages = options.pages ?? 1;

  for (let page = 0; page < pages; page++) {
    const body: Record<string, unknown> = { textQuery: query, pageSize: 20 };
    if (options.bias) {
      body.locationBias = {
        circle: {
          center: { latitude: options.bias.centre.lat, longitude: options.bias.centre.lng },
          radius: options.bias.radiusM
        }
      };
    }
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

export function toDiscovered(place: Place, doctorType: string, distanceKm = 0): DiscoveredDoctor | null {
  if (!place.location) return null;
  return {
    placeId: place.id,
    name: place.displayName?.text ?? "Unnamed clinic",
    doctorType,
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
  };
}

/**
 * A ring of sub-centres covering a radius.
 *
 * One Places call returns about twenty results near a single point, and one
 * query is capped at three pages however it is asked — so the only way to cover
 * a wide area is to ask the same question from several places and merge the
 * answers by Place ID. Neighbouring centres overlap heavily, which is the
 * point: it is what stops the seams between them having holes in them.
 *
 * Reckoned at forty per centre rather than the sixty a query can return,
 * because most of what a neighbouring centre finds has already been found.
 * Capped at sixteen, beyond which the extra centres cost billed requests and
 * return almost nothing new.
 *
 * Shared by the doctor sweep and the lead search — two implementations of this
 * would be two sets of geo arithmetic drifting apart.
 */
export function searchCentres(origin: Centre, radiusKm: number, target: number): Centre[] {
  const zones = Math.min(16, Math.max(1, Math.ceil(target / 40)));
  if (zones === 1 || radiusKm <= 3) return [origin];

  const centres: Centre[] = [origin];
  // Longitude degrees shrink towards the poles; without this the ring is an
  // ellipse and the eastern and western edges are under-covered.
  const kmPerLng = 111 * Math.max(0.2, Math.cos(origin.lat * Math.PI / 180));
  for (let i = 0; i < zones - 1; i++) {
    const angle = (2 * Math.PI * i) / (zones - 1);
    // Two rings, so the middle distances are covered as well as the rim.
    const ring = radiusKm * (i % 2 === 0 ? 0.65 : 0.35);
    centres.push({
      lat: origin.lat + (Math.cos(angle) * ring) / 111,
      lng: origin.lng + (Math.sin(angle) * ring) / kmPerLng
    });
  }
  return centres;
}
