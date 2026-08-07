/**
 * A position on the ground, and how it is written for a person to read.
 *
 * A photograph taken at a call is only proof of the call if it says where it
 * was taken, so a fix travels with every visit photo and is burnt into the
 * pixels as well as stored beside them. Burning it in matters: the phone's own
 * EXIF geotag does not survive the downscale the browser does before upload,
 * and even when it survives nobody reading the photo on a screen can see it.
 *
 * Free of React and of Mongoose, so the same wording is used by the canvas that
 * stamps the image, the screen that lists photos and the tests.
 */

export type Fix = {
  latitude: number;
  longitude: number;
  /** Radius of the phone's own uncertainty, in metres. */
  accuracy?: number;
};

/** 0.000001° is about 11 cm — past this the digits describe nothing real. */
const DECIMALS = 6;

export function isLatitude(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 90;
}

export function isLongitude(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 180;
}

/** The fix in `value`, or `undefined` if it is not a whole usable one. */
export function completeFix(value: unknown): Fix | undefined {
  const fix = value as { latitude?: unknown; longitude?: unknown; accuracy?: unknown } | null;
  if (!isLatitude(fix?.latitude) || !isLongitude(fix?.longitude)) return undefined;

  const accuracy = fix.accuracy;
  return {
    latitude: round(fix.latitude),
    longitude: round(fix.longitude),
    ...(typeof accuracy === "number" && Number.isFinite(accuracy) && accuracy >= 0
      ? { accuracy: Math.round(accuracy) }
      : {})
  };
}

const round = (value: number) => Number(value.toFixed(DECIMALS));

/** "12.971599° N" — hemisphere spelt out, because a minus sign is easy to miss. */
export const formatLatitude = (latitude: number) =>
  `${Math.abs(latitude).toFixed(DECIMALS)}° ${latitude < 0 ? "S" : "N"}`;

export const formatLongitude = (longitude: number) =>
  `${Math.abs(longitude).toFixed(DECIMALS)}° ${longitude < 0 ? "W" : "E"}`;

export const formatFix = (fix: Fix) =>
  `${formatLatitude(fix.latitude)}, ${formatLongitude(fix.longitude)}`;

/**
 * How far out the phone thinks it might be. Anything past a kilometre is shown
 * in kilometres — "±2400 m" reads as precision it plainly is not.
 */
export function formatAccuracy(accuracy: number | undefined | null): string {
  if (typeof accuracy !== "number" || !Number.isFinite(accuracy) || accuracy < 0) return "";
  return accuracy >= 1000 ? `±${(accuracy / 1000).toFixed(1)} km` : `±${Math.round(accuracy)} m`;
}

/** Drops a pin at the exact point rather than searching for the address near it. */
export const mapsPointUrl = (fix: Fix) =>
  `https://www.google.com/maps/search/?api=1&query=${fix.latitude},${fix.longitude}`;

/** "7 Aug 2026, 3:42 pm" — the same clock the rep was reading at the clinic. */
export const formatStampTime = (takenAt: Date) =>
  takenAt.toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit"
  });

/** What a pair of coordinates resolved to, as Google words it. */
export type PlaceName = { address?: string; area?: string; city?: string };

/**
 * The place, as somebody standing in it would name it.
 *
 * A coordinate proves where a photo was taken; it does not tell anybody where
 * that is. "Koramangala, Bengaluru" is what a reader recognises, so it leads —
 * and the full postal address, which nobody reads first, follows underneath.
 *
 * Falls back through the address to the coordinates themselves, so a photo taken
 * where Google has no name for the place still says something true.
 */
export function placeLabel(place: PlaceName | undefined, fix: Fix): string {
  const local = [place?.area, place?.city].filter(Boolean).join(", ");
  return local || place?.address?.trim() || formatFix(fix);
}

/**
 * The caption burnt across the bottom of a visit photo: where it was taken,
 * to the coordinate, and when.
 *
 * A fix is required, not optional. A photo of a clinic front is evidence of
 * nothing at all unless it says which clinic front — so the phone is asked
 * before the camera opens, and an unlocated photo is never taken in the first
 * place.
 */
export function stampLines(input: { fix: Fix; place?: PlaceName; takenAt: Date }): string[] {
  const label = placeLabel(input.place, input.fix);
  const address = input.place?.address?.trim();
  const when = formatStampTime(input.takenAt);
  const accuracy = formatAccuracy(input.fix.accuracy);

  return [
    label,
    // Only when it says more than the line above it already did.
    ...(address && address !== label ? [address] : []),
    `Lat ${formatLatitude(input.fix.latitude)}   Long ${formatLongitude(input.fix.longitude)}`,
    accuracy ? `${when}   ·   ${accuracy}` : when
  ];
}
