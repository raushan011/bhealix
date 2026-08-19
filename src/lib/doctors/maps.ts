/**
 * One link that opens a doctor in Google Maps, wherever the row is.
 *
 * A rep standing on a road wants the blue route line, not a debate about data
 * quality — so the link is built from the best position the record holds and
 * degrades honestly:
 *
 * 1. The doctor's own pin, when the record has one.
 * 2. The visit's check-in point — for a visit registered on the doorstep this
 *    is *better* than the pin, because it is where the rep actually stood.
 * 3. A text search for the address, when there is no point at all — Maps is
 *    good at "Dr Sharma, Indirapuram, Ghaziabad", and a search that opens is
 *    worth more than a button that is greyed out.
 *
 * Null only when the record holds nothing at all to go on.
 */

export type MapsTarget = {
  /** GeoJSON order, as the doctor stores it: [longitude, latitude]. */
  coordinates?: number[] | null;
  /** Where the rep stood when they checked in, if this is about a visit. */
  checkIn?: { latitude?: number; longitude?: number } | null;
  name?: string;
  clinicName?: string;
  fullAddress?: string;
  area?: string;
  city?: string;
};

const point = (latitude: number, longitude: number) =>
  `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;

export function doctorMapsUrl(target: MapsTarget): string | null {
  const [lng, lat] = target.coordinates ?? [];
  if (typeof lat === "number" && typeof lng === "number") return point(lat, lng);

  const checkIn = target.checkIn;
  if (typeof checkIn?.latitude === "number" && typeof checkIn?.longitude === "number") {
    return point(checkIn.latitude, checkIn.longitude);
  }

  const query = [
    target.clinicName || target.name,
    target.fullAddress || [target.area, target.city].filter(Boolean).join(", ")
  ].filter(Boolean).join(", ");
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : null;
}
