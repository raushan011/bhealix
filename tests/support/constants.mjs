/**
 * Limits the app enforces, restated for the tests.
 *
 * Copied rather than imported: `src/lib/visits.ts` resolves through the `@/`
 * alias and is TypeScript, neither of which a plain node script can load. A
 * copy also means the test states the limit it expects — if somebody raises
 * MAX_PHOTO_BYTES, the upload test should be a deliberate decision to update,
 * not something that silently follows along.
 */

/** src/lib/visits.ts — MAX_PHOTO_BYTES */
export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

/** src/lib/visits.ts — MAX_PHOTOS_PER_VISIT */
export const MAX_PHOTOS_PER_VISIT = 8;

/** src/lib/visits.ts — PHOTO_TYPES */
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Comfortably past the limit, without making the test upload tens of megabytes. */
export const MAX_UPLOAD_PROBE = MAX_PHOTO_BYTES + 512 * 1024;

/** src/lib/api.ts — pageParams caps `limit` here. */
export const MAX_PAGE_LIMIT = 100;
