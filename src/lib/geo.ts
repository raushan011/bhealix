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

/**
 * The caption burnt across the bottom of a visit photo: where it was taken,
 * to the coordinate, and when.
 *
 * A photo with no fix still gets a stamp saying so. Silence would let an
 * unlocated photo pass for a located one, which is the one thing this whole
 * feature exists to prevent.
 */
export function stampLines(
  input: { fix?: Fix | null; address?: string; takenAt: Date }
): string[] {
  const when = formatStampTime(input.takenAt);
  if (!input.fix) return ["Location unavailable", "GPS was off or could not fix a position", when];

  const accuracy = formatAccuracy(input.fix.accuracy);
  return [
    input.address?.trim() || "Address unavailable",
    `Lat ${formatLatitude(input.fix.latitude)}   Long ${formatLongitude(input.fix.longitude)}`,
    accuracy ? `${when}   ·   ${accuracy}` : when
  ];
}
