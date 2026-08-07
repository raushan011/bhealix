import { completeFix, type Fix } from "@/lib/geo";

/**
 * Asking a phone where it is, in a way that works inside a clinic.
 *
 * The browser's geolocation API is easy to call and easy to call badly, and
 * every mistake looks identical to the rep: "your location is needed" on a
 * phone whose location is plainly switched on.
 *
 *   - High accuracy means GPS, and GPS means satellites. Behind a concrete
 *     waiting-room wall it can take a minute or never arrive at all, while the
 *     wifi-and-cell fix that would have answered in a second is never asked for.
 *   - The permission prompt runs on the same clock as the request. A rep who
 *     takes eight seconds to read it and tap Allow has already spent most of a
 *     short timeout before the phone starts looking.
 *   - Every failure arrives as one error object, so a refused permission and a
 *     slow fix produce the same message unless the code reads the code.
 *
 * So: a generous first attempt at high accuracy, then a fallback that will
 * accept the network's answer, and a reason on the way out precise enough to
 * tell somebody what to actually do about it.
 */

export type FixFailure = "unsupported" | "denied" | "unavailable" | "timeout";
export type FixResult = { fix: Fix; reason?: never } | { fix?: never; reason: FixFailure };

/** Long enough to cover reading the permission prompt and a cold GPS start. */
const PRECISE_TIMEOUT_MS = 25_000;
/** The fallback is asking the network, which answers in a second or not at all. */
const COARSE_TIMEOUT_MS = 15_000;

/** A fix this old is still the same doorway, and saves the rep a wait. */
const PRECISE_MAX_AGE_MS = 30_000;
/** The fallback will take a considerably older one rather than have none. */
const COARSE_MAX_AGE_MS = 120_000;

const ask = (options: PositionOptions): Promise<FixResult> =>
  new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      position => {
        const fix = completeFix(position.coords);
        // A position the browser reports but cannot express as two numbers is
        // no position; treated as unavailable rather than silently accepted.
        resolve(fix ? { fix } : { reason: "unavailable" });
      },
      error => resolve({
        reason: error.code === error.PERMISSION_DENIED ? "denied"
          : error.code === error.TIMEOUT ? "timeout"
            : "unavailable"
      }),
      options
    );
  });

/**
 * Where the phone is, or why it will not say.
 *
 * Never rejects and never throws — every caller wants an answer it can put on
 * screen, not an exception to catch.
 */
export async function requestFix(): Promise<FixResult> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return { reason: "unsupported" };

  // A permission already refused is answered from here rather than by waiting
  // out a timeout the browser will never satisfy. Not every browser has this,
  // and a failure to answer is not a refusal, so anything unexpected falls
  // through to asking properly.
  try {
    const status = await navigator.permissions?.query({ name: "geolocation" as PermissionName });
    if (status?.state === "denied") return { reason: "denied" };
  } catch {
    // Unsupported or blocked by policy — carry on and ask.
  }

  const precise = await ask({
    enableHighAccuracy: true, timeout: PRECISE_TIMEOUT_MS, maximumAge: PRECISE_MAX_AGE_MS
  });
  if (precise.fix) return precise;

  // A refusal is final: asking again only produces the same answer, more slowly.
  if (precise.reason === "denied") return precise;

  // Indoors this is the attempt that actually succeeds. It is less precise —
  // tens of metres rather than a handful — and the accuracy travels with the
  // fix, so a photo says how sure it is rather than implying more than it knows.
  return ask({
    enableHighAccuracy: false, timeout: COARSE_TIMEOUT_MS, maximumAge: COARSE_MAX_AGE_MS
  });
}

/** What to tell somebody standing in a corridor, for each way it can fail. */
export const FIX_MESSAGE: Record<FixFailure, string> = {
  unsupported: "This phone cannot report its location, so a photo cannot be stamped with where it was taken.",
  denied: "Location is blocked for this site. Open the padlock beside the address bar, allow location, then try again.",
  unavailable: "Your phone could not find its position. Step towards a window or outside, then try again.",
  timeout: "Finding your location is taking too long — the signal is weak here. Step towards a window or outside, then try again."
};
