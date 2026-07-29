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
  location: { latitude: number; longitude: number };
  rating?: number;
  userRatingCount?: number;
  nationalPhoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  distanceKm: number;
  category: string;
};

export function externalDoctorToPayload(place: ExternalDoctor) {
  return {
    googlePlaceId: place.id,
    name: place.displayName?.text ?? "Unknown doctor or clinic",
    doctorType: place.category,
    fullAddress: place.formattedAddress ?? "",
    phone: place.nationalPhoneNumber ?? "",
    website: place.websiteUri ?? "",
    googleMapsUrl: place.googleMapsUri ?? "",
    latitude: place.location.latitude,
    longitude: place.location.longitude,
    rating: place.rating,
    reviewCount: place.userRatingCount,
    distanceKm: place.distanceKm
  };
}
