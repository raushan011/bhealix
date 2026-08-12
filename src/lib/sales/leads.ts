import { z } from "zod";
import type { Place } from "@/lib/doctors/places";

/**
 * Finding businesses worth approaching, and keeping what was found.
 *
 * The affiliate operation grows by somebody deciding that beauty parlours in
 * Ghaziabad are worth a call, searching for them, and then working the list
 * over the following fortnight. Both halves matter: a search nobody saved is a
 * search that will be paid for again next week, and Google's quota is billed.
 *
 * Deliberately separate from doctor discovery next door. That search knows what
 * it is looking for — the thirteen specialities a skincare brand cares about —
 * and every result becomes a `Doctor` with a call window and a place on a
 * route. This one is told what to look for, and what to file it under, because
 * neither the CRM nor anybody else can guess what the next campaign is about.
 *
 * Pure: no mongoose, no react. The schema below is parsed in the browser before
 * a request is sent *and* on the server before anything is written, so the two
 * can never disagree about what a valid search is (§4.1).
 */

/**
 * How far a lead has got. Four states rather than a workflow: this is a list to
 * work through, and the only questions asked of it are "who have we not rung
 * yet" and "who said yes".
 */
export const LEAD_STATUSES = ["New", "Contacted", "Interested", "Not interested"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/**
 * How a lead got into the list. Only the search puts one there today, but a
 * name written down at a trade fair is a real lead, and a source field is what
 * keeps a later sweep of the same area from treating it as a stray.
 */
export const LEAD_SOURCES = ["Google", "Manual"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

/**
 * Starting points for the type field, not a closed list.
 *
 * The type is what makes a saved lead findable again — "show me the beauty
 * parlours" — so it is required. But an enum here would mean a deployment every
 * time somebody wants to sweep a trade nobody thought of, which is the opposite
 * of what this screen is for. Suggested, then, and free text underneath.
 */
export const LEAD_TYPE_SUGGESTIONS = [
  "Beauty parlour",
  "Salon",
  "Spa",
  "Skin clinic",
  "Cosmetic store",
  "Chemist",
  "Wellness centre",
  "Gym",
  "Nutritionist",
  "Boutique"
] as const;

/**
 * Google returns at most three pages of twenty for one text search, and then
 * stops — there is no fourth page to ask for at any price.
 *
 * So sixty is the ceiling the API imposes, not one this code chose, and asking
 * for more would be a promise the screen could not keep. A wider sweep is a
 * narrower location: "beauty parlour" across two districts is two searches.
 */
export const MAX_LEAD_RESULTS = 60;

/** Results per Google page, and so the granularity of the pages we ask for. */
export const LEAD_PAGE_SIZE = 20;

/** How many Places pages a limit actually needs. One call each, one billed request each. */
export const leadSearchPages = (resultLimit: number) =>
  Math.min(3, Math.max(1, Math.ceil(resultLimit / LEAD_PAGE_SIZE)));

const typeField = z.string().trim()
  .min(2, "Give the results a type, so the list can be found again")
  .max(60, "A type is a short label, like Beauty parlour");

export const leadSearchSchema = z.object({
  query: z.string().trim().min(2, "Enter what to look for, like beauty parlour"),
  location: z.string().trim().min(2, "Enter a city, area or PIN code"),
  type: typeField,
  resultLimit: z.number().int()
    .min(5, "Ask for at least 5 results")
    .max(MAX_LEAD_RESULTS, `Google returns at most ${MAX_LEAD_RESULTS} results for one search`)
    .default(20)
});

export type LeadSearchInput = z.infer<typeof leadSearchSchema>;

/** One result as it comes back from the search, before anybody decides to keep it. */
export type DiscoveredLead = {
  placeId: string;
  name: string;
  type: string;
  address: string;
  area: string;
  city: string;
  phone: string;
  website: string;
  mapsUrl: string;
  rating?: number;
  reviewCount?: number;
  latitude?: number;
  longitude?: number;
};

const component = (place: Place, type: string) =>
  place.addressComponents?.find(part => part.types?.includes(type))?.longText ?? "";

/**
 * Shapes one Google place into a lead.
 *
 * Unlike a discovered doctor, a place with no coordinates is still kept. A
 * doctor without a point cannot be put on a route, which is most of what the
 * doctor CRM does with one; a parlour is reached by ringing the number on the
 * card, and dropping it would throw away the very rows a small local business
 * is most likely to be.
 */
export function toLead(place: Place, type: string): DiscoveredLead | null {
  if (!place.id) return null;
  return {
    placeId: place.id,
    name: place.displayName?.text ?? "Unnamed business",
    type,
    address: place.formattedAddress ?? place.shortFormattedAddress ?? "",
    area: component(place, "sublocality_level_1") || component(place, "sublocality") || component(place, "neighborhood"),
    city: component(place, "locality") || component(place, "administrative_area_level_2"),
    phone: place.nationalPhoneNumber ?? "",
    website: place.websiteUri ?? "",
    mapsUrl: place.googleMapsUri ?? "",
    rating: place.rating,
    reviewCount: place.userRatingCount,
    latitude: place.location?.latitude,
    longitude: place.location?.longitude
  };
}

const leadRowSchema = z.object({
  /** Google's own id — absent only for a lead typed in by hand. */
  placeId: z.string().trim().max(200).optional(),
  name: z.string().trim().min(1, "A lead needs a name").max(160),
  type: typeField,
  address: z.string().trim().max(400).default(""),
  area: z.string().trim().max(120).default(""),
  city: z.string().trim().max(120).default(""),
  phone: z.string().trim().max(40).default(""),
  website: z.string().trim().max(300).default(""),
  mapsUrl: z.string().trim().max(500).default(""),
  rating: z.number().min(0).max(5).optional(),
  reviewCount: z.number().int().min(0).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional()
});

export const leadSaveSchema = z.object({
  leads: z.array(leadRowSchema)
    .min(1, "Choose at least one result to save")
    .max(MAX_LEAD_RESULTS),
  /** What was typed to find them, carried onto every row — see the model. */
  searchQuery: z.string().trim().max(120).optional(),
  searchLocation: z.string().trim().max(120).optional()
});

export type LeadRow = z.infer<typeof leadRowSchema>;

/**
 * A search result in the words the collection stores it in.
 *
 * Only two names differ — `placeId` and `mapsUrl` are `googlePlaceId` and
 * `googleMapsUrl` on the document, matching what the doctor directory already
 * calls them — but they are exactly the two a spread would drop silently,
 * leaving a saved lead with no link to Maps and no way to dedupe it.
 */
export function toLeadFields(row: LeadRow) {
  const { placeId, mapsUrl, ...rest } = row;
  return { ...rest, googlePlaceId: placeId, googleMapsUrl: mapsUrl };
}

export const leadUpdateSchema = z.object({
  status: z.enum(LEAD_STATUSES).optional(),
  type: typeField.optional(),
  phone: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(1000).optional()
}).refine(input => Object.keys(input).length > 0, "Nothing to change");

/** Where a lead has got to, in the colours a status means everywhere else. */
export function leadTone(status: string): "success" | "info" | "warn" | "danger" | "neutral" {
  switch (status) {
    case "Interested": return "success";
    case "Contacted": return "info";
    case "Not interested": return "danger";
    default: return "neutral";
  }
}
