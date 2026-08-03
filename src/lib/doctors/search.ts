import { z } from "zod";

export const SKIN_DOCTOR_TYPES = [
  "Dermatologist",
  "Skin specialist",
  "Skin clinic",
  "Cosmetologist",
  "Aesthetic dermatologist",
  "Aesthetic physician",
  "Trichologist",
  "Hair specialist",
  "Acne specialist",
  "Pigmentation specialist",
  "Cosmetic clinic",
  "Paediatric dermatologist",
  "Plastic surgeon",
  "Venereologist",
  "Skin and hair clinic",
  "General physician"
] as const;

export const doctorSearchSchema = z.object({
  doctorType: z.enum(SKIN_DOCTOR_TYPES),
  location: z.string().trim().min(2),
  radiusKm: z.number().positive().max(100)
});

export type ExternalDoctor = {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  rating?: number;
  userRatingCount?: number;
  nationalPhoneNumber?: string;
  email?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  distanceKm: number;
  category: string;
  fromFile?: boolean;
};

export function externalDoctorToPayload(place: ExternalDoctor) {
  return {
    ...(place.fromFile ? {} : { googlePlaceId: place.id }),
    name: place.displayName?.text ?? "Unknown doctor or clinic",
    doctorType: place.category,
    fullAddress: place.formattedAddress ?? "",
    phone: place.nationalPhoneNumber ?? "",
    ...(place.email ? { email: place.email } : {}),
    website: place.websiteUri ?? "",
    googleMapsUrl: place.googleMapsUri ?? "",
    latitude: place.location?.latitude,
    longitude: place.location?.longitude,
    rating: place.rating,
    reviewCount: place.userRatingCount,
    distanceKm: place.distanceKm
  };
}

const excelHeaderText = (row: Record<string, unknown>, ...keys: string[]) => {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
};
const excelHeaderNumber = (row: Record<string, unknown>, ...keys: string[]) => {
  const value = excelHeaderText(row, ...keys);
  if (!value) return undefined;
  const parsed = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
};

export function excelRowToExternalDoctor(row: Record<string, unknown>, fallbackId: string): ExternalDoctor {
  const latitude = excelHeaderNumber(row, "Latitude", "latitude");
  const longitude = excelHeaderNumber(row, "Longitude", "longitude");
  const placeId = excelHeaderText(row, "Place ID", "googlePlaceId");
  return {
    id: placeId || fallbackId,
    fromFile: !placeId,
    displayName: { text: excelHeaderText(row, "Doctor or Clinic", "Doctor Name", "name") },
    category: excelHeaderText(row, "Type", "doctorType", "category") || "Dermatologist",
    formattedAddress: excelHeaderText(row, "Address", "fullAddress"),
    nationalPhoneNumber: excelHeaderText(row, "Mobile", "Mobile Number", "phone") || undefined,
    email: excelHeaderText(row, "Email", "email") || undefined,
    googleMapsUri: excelHeaderText(row, "Google Maps", "googleMapsUrl") || undefined,
    rating: excelHeaderNumber(row, "Rating"),
    userRatingCount: excelHeaderNumber(row, "Reviews", "reviewCount"),
    distanceKm: excelHeaderNumber(row, "Distance", "distanceKm") ?? 0,
    location: latitude !== undefined && longitude !== undefined ? { latitude, longitude } : undefined
  };
}
