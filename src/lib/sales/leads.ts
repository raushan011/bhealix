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
 * Google returns at most three pages of twenty for **one** text search, and
 * then stops — there is no fourth page to ask for at any price.
 *
 * Sixty is therefore the ceiling on a single query, not on a search. The way
 * past it is the way the doctor sweep next door gets to five hundred: ask the
 * same question from a ring of sub-centres around the location and merge the
 * answers by Place ID. Each centre returns its own sixty, and the overlap
 * between neighbouring centres is what stops the seams from having holes in
 * them.
 */
export const MAX_LEAD_RESULTS = 500;

/** What one query can ever return, whatever it is asked for. */
export const LEAD_QUERY_CEILING = 60;

/** Results per Google page, and so the granularity of the pages we ask for. */
export const LEAD_PAGE_SIZE = 20;

/** How many Places pages a limit actually needs. One call each, one billed request each. */
export const leadSearchPages = (resultLimit: number) =>
  Math.min(3, Math.max(1, Math.ceil(resultLimit / LEAD_PAGE_SIZE)));

/**
 * How many sub-centres a target needs.
 *
 * Deliberately reckoned at forty per centre rather than sixty: neighbouring
 * centres return many of the same places, and sizing the ring for the ceiling
 * would leave a wide search short of what it promised. Capped at sixteen, which
 * is where the doctor sweep caps too — beyond that the extra centres cost
 * billed requests and return almost nothing new.
 */
export const leadSearchZones = (resultLimit: number) =>
  Math.min(16, Math.max(1, Math.ceil(resultLimit / 40)));

/** Billed Google requests a search will cost at worst: every centre, every page. */
export const estimateLeadRequests = (resultLimit: number) =>
  leadSearchZones(resultLimit) * leadSearchPages(Math.min(resultLimit, LEAD_QUERY_CEILING));

// --------------------------------------------------------------- reaching out

/** Every lead in this directory is Indian; Google returns local numbers as often as not. */
export const DEFAULT_DIAL_CODE = "91";

/**
 * A number as WhatsApp wants it: digits only, country code included, no plus.
 *
 * Google Places hands these back however the listing typed them —
 * `096503 06893`, `+91 96503 06893`, `0120-4567890`. `wa.me` accepts exactly
 * one of those shapes and answers the rest with "phone number shared via url is
 * invalid", so the normalising *is* the feature.
 *
 * The leading zero is a trunk prefix for dialling inside the country and has no
 * meaning once a country code is on the front — leaving it in is the single
 * commonest way one of these links dies.
 */
export function whatsappNumber(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (!digits) return null;

  // Already international: 91 followed by a ten-digit number.
  if (digits.length === 12 && digits.startsWith(DEFAULT_DIAL_CODE)) return digits;

  const local = digits.replace(/^0+/, "");
  // Too short to be a number anybody can be reached on.
  if (local.length < 8) return null;
  return `${DEFAULT_DIAL_CODE}${local}`;
}

/** The link itself, or nothing when the number cannot be made sense of. */
export const whatsappUrl = (phone: string | null | undefined) => {
  const number = whatsappNumber(phone);
  return number ? `https://wa.me/${number}` : null;
};

/**
 * The same number as something a phone will dial.
 *
 * Normalised through `whatsappNumber` so a listing that published `098999 43298`
 * dials as `+919899943298` — a desk phone or a laptop softphone will not guess
 * the country, and a trunk zero in front of a country code reaches nobody.
 * Falls back to whatever digits are there when the number is too odd to
 * normalise, because a half-right `tel:` is still better than a dead link on a
 * row where the number is the only thing anybody wants.
 */
export function telUrl(phone: string | null | undefined): string | null {
  const raw = (phone ?? "").replace(/[^\d+]/g, "");
  if (raw.replace(/\D/g, "").length < 6) return null;
  const number = whatsappNumber(phone);
  return number ? `tel:+${number}` : `tel:${raw}`;
}

const typeField = z.string().trim()
  .min(2, "Give the results a type, so the list can be found again")
  .max(60, "A type is a short label, like Beauty parlour");

/**
 * How far around the location a sweep reaches.
 *
 * Offered as choices rather than a free number because each step has a
 * meaning: 5 is a neighbourhood, 10 an area, 25 a city — the size somebody
 * works in a day, and the old fixed value — 50 a city and its satellites,
 * 100 a district. Wider is more billed requests for the same target, so the
 * choice is worth making consciously.
 */
export const LEAD_RADIUS_CHOICES = [
  { km: 5, label: "5 km — a neighbourhood" },
  { km: 10, label: "10 km — an area" },
  { km: 25, label: "25 km — a city" },
  { km: 50, label: "50 km — city and outskirts" },
  { km: 100, label: "100 km — the whole district" }
] as const;

export const DEFAULT_LEAD_RADIUS_KM = 25;

export const leadSearchSchema = z.object({
  query: z.string().trim().min(2, "Enter what to look for, like beauty parlour"),
  location: z.string().trim().min(2, "Enter a city, area or PIN code"),
  type: typeField,
  resultLimit: z.number().int()
    .min(5, "Ask for at least 5 results")
    .max(MAX_LEAD_RESULTS, `Google returns at most ${MAX_LEAD_RESULTS} results for one search`)
    .default(20),
  /** How far around the location to sweep. */
  radiusKm: z.number().int().min(2).max(100).default(DEFAULT_LEAD_RADIUS_KM)
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

/**
 * A Google-sourced extra: kept when it is sensible, quietly dropped when it is
 * not — never allowed to veto the row it sits on.
 *
 * What a lead is *for* is its name and its phone number; the website, the
 * rating, the Maps link are furniture. Google occasionally returns furniture
 * the caps here dislike — a `websiteUri` that is a four-hundred-character
 * Facebook share link was what taught this lesson, when one parlour in
 * Bulandshahar failed the save of the sixty-six rows around it with
 * "leads.24.website: Invalid input" and no way to tell which card that was.
 * The caps stay (nothing pathological reaches the collection), but `catch`
 * turns "refuse the batch" into "save the lead without that field".
 */
const dropIfUnusable = <T extends z.ZodType>(schema: T, fallback: z.output<T>) => schema.catch(fallback);

const leadRowSchema = z.object({
  /** Google's own id — absent only for a lead typed in by hand. */
  placeId: z.string().trim().max(200).optional(),
  /** Required — but an over-long name is trimmed to fit rather than refused. */
  name: z.string().trim().min(1, "A lead needs a name").transform(value => value.slice(0, 160)),
  type: typeField,
  address: dropIfUnusable(z.string().trim().max(400).default(""), ""),
  area: dropIfUnusable(z.string().trim().max(120).default(""), ""),
  city: dropIfUnusable(z.string().trim().max(120).default(""), ""),
  phone: dropIfUnusable(z.string().trim().max(40).default(""), ""),
  /** 2000 is the practical URL ceiling; share links with tracking get there. */
  website: dropIfUnusable(z.string().trim().max(2000).default(""), ""),
  mapsUrl: dropIfUnusable(z.string().trim().max(2000).default(""), ""),
  rating: dropIfUnusable(z.number().min(0).max(5).optional(), undefined),
  reviewCount: dropIfUnusable(z.number().int().min(0).optional(), undefined),
  latitude: dropIfUnusable(z.number().min(-90).max(90).optional(), undefined),
  longitude: dropIfUnusable(z.number().min(-180).max(180).optional(), undefined)
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

/**
 * The one spelling a type gets.
 *
 * The type is what makes a saved lead findable, and it is typed by hand — so
 * "Beauty parlour", "beauty parlour" and "Beauty  Parlour" arrive as three
 * strings and become three entries in the filter, splitting one list into
 * three that each look incomplete. Every write path runs the typed value
 * through this against the types already saved: an existing spelling wins
 * case-blind, so the filter shows one entry however the second person spelt
 * it, and a genuinely new type is kept exactly as typed.
 */
export function canonicalType(typed: string, existing: readonly string[]): string {
  const wanted = typed.trim().replace(/\s+/g, " ");
  const match = wanted.toLowerCase();
  return existing.find(candidate => candidate.trim().replace(/\s+/g, " ").toLowerCase() === match) ?? wanted;
}

/** Every lead filed under this type, spelt however it was spelt. */
export const typeMatches = (type: string) => {
  const escaped = type.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return { type: new RegExp(`^\\s*${escaped}\\s*$`, "i") };
};

/** Renaming a type wholesale: every lead filed under one word moves to another. */
export const typeRenameSchema = z.object({
  from: z.string().trim().min(1, "Which type to rename").max(60),
  to: typeField
});

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

// ------------------------------------------------------------------- remarks

/**
 * What was said, kept as a thread rather than a field.
 *
 * `notes` already exists and stays: it is the standing description of a lead —
 * "asks for the owner, shop shuts on Tuesdays" — the thing you want to read
 * *before* dialling. A remark is the opposite; it is one dated line about one
 * conversation, and the value of it is entirely in the sequence. Overwriting a
 * note with "no answer" throws away last week's "call back after Diwali", which
 * is exactly the sentence that made this call worth making.
 *
 * So: append-only in spirit, editable in practice (a remark typed on a phone
 * between two calls has typos in it), and each one carries who wrote it and
 * when, because six months on "why did we stop chasing this parlour" is a
 * question about a person as much as a date.
 */
export const REMARK_CHANNELS = ["Call", "WhatsApp", "Visit", "Note"] as const;
export type RemarkChannel = (typeof REMARK_CHANNELS)[number];

/**
 * The channels that mean somebody actually reached out, as opposed to writing
 * something down. Only these move `lastContactedAt`, and so only these take a
 * lead out of the outreach queue — filing a note to self must never look like a
 * message that was sent.
 */
const REACHED_OUT: readonly string[] = ["Call", "WhatsApp", "Visit"];
export const isOutreach = (channel: string) => REACHED_OUT.includes(channel);

/**
 * The five things a call actually ends in, one tap each.
 *
 * A remark box on a phone, typed standing up between two numbers, is a remark
 * box that stays empty — and an empty thread is worse than no thread, because
 * the list then lies about having been worked. The presets fill both halves of
 * what a call decides: the sentence, and where that leaves the lead. They are
 * starting text, not a closed list; the box stays editable underneath.
 */
export const REMARK_PRESETS: readonly { label: string; text: string; status?: LeadStatus }[] = [
  { label: "No answer", text: "Rang — no answer." },
  { label: "Call back later", text: "Reached them, asked to call back later.", status: "Contacted" },
  { label: "Wants details", text: "Interested — asked for prices and details.", status: "Interested" },
  { label: "Not interested", text: "Not interested at the moment.", status: "Not interested" },
  { label: "Wrong number", text: "Wrong number — the listing is out of date." }
];

const remarkText = z.string().trim()
  .min(2, "Write what was said")
  .max(1000, "A remark is a line or two, not a report");

export const remarkSchema = z.object({
  text: remarkText,
  channel: z.enum(REMARK_CHANNELS).default("Note"),
  /** Where the conversation left the lead. Left off when it changed nothing. */
  status: z.enum(LEAD_STATUSES).optional()
});

export const remarkEditSchema = z.object({
  text: remarkText.optional(),
  channel: z.enum(REMARK_CHANNELS).optional()
}).refine(input => Object.keys(input).length > 0, "Nothing to change");

/** What a remark is filed under, in the colours the rest of the app uses. */
export function remarkTone(channel: string): "brand" | "success" | "info" | "neutral" {
  switch (channel) {
    case "Call": return "info";
    case "WhatsApp": return "success";
    case "Visit": return "brand";
    default: return "neutral";
  }
}

// -------------------------------------------------------- asking for a subset

/** A user's words as a substring match, with the regex metacharacters defanged. */
export const like = (value: string) => new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

/**
 * The saved-list filters, read once and agreed on everywhere.
 *
 * Three screens now ask the same question of this collection — the list, the
 * remarks log and the spreadsheet export — and the export is the one that must
 * not drift: a download labelled "Beauty parlour, Noida" that quietly carries a
 * different set of rows than the screen it was pressed from is a spreadsheet
 * somebody makes decisions on.
 *
 * Status is deliberately left out and applied separately by the caller. The list
 * counts each status *before* narrowing to one, so the filter labels can say how
 * many are in each; folding it in here would report every other state as zero.
 */
export function leadWhere(params: URLSearchParams): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  const and: Record<string, unknown>[] = [];

  const q = (params.get("q") ?? "").trim();
  if (q) {
    const match = like(q);
    // Its own `$or` inside `$and`, so a later condition cannot quietly
    // overwrite it (§11).
    and.push({ $or: [{ name: match }, { phone: match }, { address: match }, { area: match }, { city: match }] });
  }

  const type = params.get("type");
  if (type) where.type = type;

  const city = params.get("city");
  if (city) where.city = city;

  return and.length ? { ...where, $and: and } : where;
}

/** The same filter, narrowed to one status — ignoring anything that is not one. */
export function withLeadStatus(where: Record<string, unknown>, status: string | null) {
  return status && (LEAD_STATUSES as readonly string[]).includes(status) ? { ...where, status } : where;
}

// -------------------------------------------------------------- many at once

/**
 * Working a list means doing the same thing to forty rows.
 *
 * Marking a whole sweep `Not interested` one dropdown at a time is forty round
 * trips and four minutes, and the thing people do instead is not bother — which
 * leaves the filters lying. Deleting is here for the same reason and is the more
 * dangerous half, so it is capped and the screen asks first.
 */
export const LEAD_BULK_ACTIONS = ["status", "type", "delete"] as const;
export type LeadBulkAction = (typeof LEAD_BULK_ACTIONS)[number];

export const bulkLeadSchema = z.object({
  ids: z.array(z.string().regex(/^[a-f\d]{24}$/i, "Unknown lead"))
    .min(1, "Choose at least one lead")
    .max(500, "Five hundred at a time is the limit"),
  action: z.enum(LEAD_BULK_ACTIONS),
  status: z.enum(LEAD_STATUSES).optional(),
  type: typeField.optional()
})
  .refine(input => input.action !== "status" || input.status, "Choose a status to set")
  .refine(input => input.action !== "type" || input.type, "Enter a type to file them under");
