/**
 * Google Maps deep links.
 *
 * Mongo stores GeoJSON — [longitude, latitude] — while Maps URLs want
 * "latitude,longitude", so every point goes through `toLatLng` first.
 */

type Located = { location?: { coordinates?: number[] } | null } | null | undefined;

export function toLatLng(doctor: Located): string | null {
  const coordinates = doctor?.location?.coordinates;
  return coordinates?.length === 2 ? `${coordinates[1]},${coordinates[0]}` : null;
}

/** Turn-by-turn to a single doctor from wherever the rep is standing. */
export function directionsUrl(doctor: Located): string | null {
  const point = toLatLng(doctor);
  return point ? `https://www.google.com/maps/dir/?api=1&destination=${point}&travelmode=driving` : null;
}

/**
 * The whole day as one route. Google caps a shared directions link at nine
 * waypoints between origin and destination, so longer routes keep the first
 * nine and still end at the last stop.
 */
export function routeUrl(doctors: Located[]): string | null {
  const points = doctors.map(toLatLng).filter((point): point is string => point !== null);
  if (points.length < 2) return null;
  const waypoints = points.slice(1, -1).slice(0, 9).join("|");
  return `https://www.google.com/maps/dir/?api=1&origin=${points[0]}&destination=${points.at(-1)}`
    + `${waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : ""}&travelmode=driving`;
}
