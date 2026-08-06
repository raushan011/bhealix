/**
 * Visit vocabulary shared by the client form and the server model. Kept out of
 * the Mongoose file so client bundles never pull in the database layer.
 */
export const VISIT_OUTCOMES = [
  "Met doctor",
  "Met assistant only",
  "Doctor unavailable",
  "Clinic closed",
  "Asked to come later",
  "Wrong address"
] as const;

export const INTEREST_LEVELS = ["High", "Medium", "Low", "Not interested"] as const;

export type VisitOutcome = (typeof VISIT_OUTCOMES)[number];
export type InterestLevel = (typeof INTEREST_LEVELS)[number];

// ----------------------------------------------------------------- photographs

/**
 * A photograph taken at a call is proof that the rep stood in that clinic on
 * that day — it settles a query while the query is still live and has no use
 * afterwards. It is also somebody's premises and, often enough, their face, so
 * holding it indefinitely would be collecting what we have no reason to keep.
 *
 * Thirty days is the whole life of one. Deletion is not a job that has to be
 * remembered: every photo is written with an `expiresAt` and the collection
 * carries a MongoDB TTL index on it, so the database removes them itself. The
 * reading queries also exclude anything already past its date, so a photo is
 * never served in the minute or so between expiry and the sweep.
 */
export const PHOTO_RETENTION_DAYS = 30;

/** Enough for a clinic front, a visiting card and a shelf, without becoming an album. */
export const MAX_PHOTOS_PER_VISIT = 8;

/** After the phone has downscaled it. A 12 MP photo lands well under this. */
export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export const photoExpiryFrom = (uploadedAt: Date) =>
  new Date(uploadedAt.getTime() + PHOTO_RETENTION_DAYS * 86_400_000);

/** Whole days left before a photo is removed; never negative. */
export const daysLeft = (expiresAt: string | Date) =>
  Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000));
