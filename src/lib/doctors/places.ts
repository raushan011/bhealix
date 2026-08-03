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
