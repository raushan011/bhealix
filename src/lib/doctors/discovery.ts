import { z } from "zod";

/** Search terms tuned for a skincare brand — doctors who treat skin and prescribe for it. */
export const DOCTOR_TYPES = [
  "Dermatologist",
  "Skin specialist",
  "Skin and hair clinic",
  "Cosmetologist",
  "Aesthetic dermatologist",
  "Trichologist",
  "Acne specialist",
  "Pigmentation specialist",
  "Cosmetic clinic",
  "Paediatric dermatologist",
  "Plastic surgeon",
  "Venereologist",
  "General physician"
] as const;

export const RADIUS_OPTIONS = [2, 5, 10, 25, 50, 75, 100] as const;

export const MAX_RESULTS = 500;

/**
 * Worst-case Google Places requests for a search: every chosen type is swept
 * across every sub-area, two pages each. The search stops early once enough
 * results are found, so this is a ceiling rather than a prediction — but it is
 * what a wide, thin search actually costs.
 */
export function estimateGoogleRequests(doctorTypes: number, resultLimit: number) {
  const zones = Math.min(16, Math.max(1, Math.ceil(resultLimit / 40)));
  return Math.max(1, doctorTypes) * zones * 2;
}

export const discoverySchema = z.object({
  location: z.string().trim().min(2, "Enter a city, area or PIN code"),
  radiusKm: z.number().positive().max(100, "Radius cannot be more than 100 km"),
  doctorTypes: z.array(z.enum(DOCTOR_TYPES))
    .min(1, "Choose at least one doctor type")
    .max(DOCTOR_TYPES.length),
  resultLimit: z.number().int()
    .min(10, "Ask for at least 10 results")
    .max(MAX_RESULTS, `Maximum results cannot be more than ${MAX_RESULTS}`)
    .default(120)
});

export type DiscoveryInput = z.infer<typeof discoverySchema>;

/** Looking up one named doctor or clinic, rather than sweeping an area. */
export const lookupSchema = z.object({
  query: z.string().trim().min(3, "Enter at least three characters of the name"),
  near: z.string().trim().max(80).optional()
});

export type DiscoveredDoctor = {
  placeId: string;
  name: string;
  doctorType: string;
  address: string;
  area: string;
  city: string;
  phone: string;
  website: string;
  mapsUrl: string;
  rating?: number;
  reviewCount?: number;
  latitude: number;
  longitude: number;
  distanceKm: number;
};

/** The single column shape used for both the Excel download and the upload. */
export const EXCEL_COLUMNS = [
  "Doctor Name", "Doctor Type", "Clinic", "Mobile", "Email",
  "Address", "Area", "City", "Latitude", "Longitude",
  "Rating", "Reviews", "Google Maps", "Place ID"
] as const;

export function toExcelRow(doctor: DiscoveredDoctor) {
  return {
    "Doctor Name": doctor.name,
    "Doctor Type": doctor.doctorType,
    "Clinic": doctor.name,
    "Mobile": doctor.phone || "",
    "Email": "",
    "Address": doctor.address,
    "Area": doctor.area,
    "City": doctor.city,
    "Latitude": doctor.latitude,
    "Longitude": doctor.longitude,
    "Rating": doctor.rating ?? "",
    "Reviews": doctor.reviewCount ?? "",
    "Google Maps": doctor.mapsUrl,
    "Place ID": doctor.placeId
  };
}

const text = (row: Record<string, unknown>, ...keys: string[]) => {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
};
const number = (row: Record<string, unknown>, ...keys: string[]) => {
  const raw = text(row, ...keys);
  if (!raw) return undefined;
  const parsed = Number(raw.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
};

/** Reads a row from an uploaded sheet back into the shape the save endpoint takes. */
export function fromExcelRow(row: Record<string, unknown>) {
  const name = text(row, "Doctor Name", "Doctor or Clinic", "name");
  if (!name) return null;
  return {
    googlePlaceId: text(row, "Place ID", "googlePlaceId") || undefined,
    name,
    specialty: text(row, "Doctor Type", "Type", "Specialty") || "Dermatologist",
    clinicName: text(row, "Clinic", "Clinic Name") || name,
    phone: text(row, "Mobile", "Mobile Number", "Phone"),
    email: text(row, "Email"),
    fullAddress: text(row, "Address", "Full Address"),
    area: text(row, "Area", "Locality"),
    city: text(row, "City"),
    googleMapsUrl: text(row, "Google Maps", "Maps"),
    rating: number(row, "Rating"),
    reviewCount: number(row, "Reviews"),
    latitude: number(row, "Latitude"),
    longitude: number(row, "Longitude"),
    source: "Excel" as const
  };
}
