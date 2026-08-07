/**
 * A doctor's place on the map, as MongoDB will accept it.
 *
 * A 2dsphere index skips a document with no location, but rejects one holding
 * half a point — and it rejects it at insert time, so a missing coordinate
 * fails the entire save with a message about geo keys that names nothing
 * anybody was trying to do. A doctor typed in at the desk, or added by a rep
 * with location switched off, has no coordinates yet and must still save.
 *
 * So a location is a complete point or it is not there at all, and this decides
 * which. Free of Mongoose so the rule can be tested without a database.
 */

export type Point = { type: "Point"; coordinates: [number, number] };

/** The point in `value`, or `undefined` if there isn't a whole one. */
export function completePoint(value: unknown): Point | undefined {
  const coordinates = (value as { coordinates?: unknown } | null)?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length !== 2) return undefined;

  const [longitude, latitude] = coordinates;
  if (!isDegrees(longitude, 180) || !isDegrees(latitude, 90)) return undefined;
  return { type: "Point", coordinates: [longitude, latitude] };
}

/** MongoDB refuses a coordinate off the globe as firmly as a missing one. */
const isDegrees = (value: unknown, limit: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= limit;
