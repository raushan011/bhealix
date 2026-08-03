import { describe, expect, it } from "vitest";
import {
  DOCTOR_TYPES, MAX_RESULTS, discoverySchema, estimateGoogleRequests,
  fromExcelRow, lookupSchema, toExcelRow
} from "./discovery";

const base = { location: "Noida", radiusKm: 10, doctorTypes: ["Dermatologist"] };

describe("discovery input", () => {
  it("caps the search radius at 100 km", () => {
    expect(discoverySchema.safeParse({ ...base, radiusKm: 101 }).success).toBe(false);
    expect(discoverySchema.safeParse({ ...base, radiusKm: 100 }).success).toBe(true);
  });

  it("requires at least one doctor type", () => {
    expect(discoverySchema.safeParse({ ...base, doctorTypes: [] }).success).toBe(false);
  });

  it("accepts every doctor type at once", () => {
    expect(discoverySchema.safeParse({ ...base, doctorTypes: [...DOCTOR_TYPES] }).success).toBe(true);
  });

  it("still rejects a type that is not on the list", () => {
    expect(discoverySchema.safeParse({ ...base, doctorTypes: ["Dentist"] }).success).toBe(false);
  });

  it("accepts any whole number of results up to the maximum", () => {
    expect(discoverySchema.safeParse({ ...base, resultLimit: 75 }).success).toBe(true);
    expect(discoverySchema.safeParse({ ...base, resultLimit: MAX_RESULTS }).success).toBe(true);
  });

  it("rejects a result count above the maximum, below ten, or fractional", () => {
    expect(discoverySchema.safeParse({ ...base, resultLimit: MAX_RESULTS + 1 }).success).toBe(false);
    expect(discoverySchema.safeParse({ ...base, resultLimit: 9 }).success).toBe(false);
    expect(discoverySchema.safeParse({ ...base, resultLimit: 50.5 }).success).toBe(false);
  });

  it("defaults the result count when it is left out", () => {
    const parsed = discoverySchema.safeParse(base);
    expect(parsed.success && parsed.data.resultLimit).toBe(120);
  });
});

describe("google request estimate", () => {
  it("grows with the number of doctor types", () => {
    const one = estimateGoogleRequests(1, 120);
    const all = estimateGoogleRequests(DOCTOR_TYPES.length, 120);
    expect(all).toBe(one * DOCTOR_TYPES.length);
  });

  it("grows with the requested result count", () => {
    expect(estimateGoogleRequests(1, 40)).toBeLessThan(estimateGoogleRequests(1, 400));
    // 40 results per sub-area, two requests each: 500 needs 13 sub-areas.
    expect(estimateGoogleRequests(1, MAX_RESULTS)).toBe(26);
  });

  it("stops growing at the 16 sub-area ceiling the sweep enforces", () => {
    // Only reachable above the allowed maximum, but the guard must hold.
    expect(estimateGoogleRequests(1, 10_000)).toBe(32);
  });

  it("never reports zero, even with nothing selected", () => {
    expect(estimateGoogleRequests(0, 120)).toBeGreaterThan(0);
  });
});

describe("lookup by name", () => {
  it("needs a few characters before searching", () => {
    expect(lookupSchema.safeParse({ query: "Dr" }).success).toBe(false);
    expect(lookupSchema.safeParse({ query: "Dr Ranjana Singh" }).success).toBe(true);
  });

  it("treats the surrounding area as optional", () => {
    expect(lookupSchema.safeParse({ query: "Skin Clinic", near: "Ghaziabad" }).success).toBe(true);
    expect(lookupSchema.safeParse({ query: "Skin Clinic" }).success).toBe(true);
  });
});

describe("excel round trip", () => {
  it("reads back a downloaded row without losing coordinates or contact details", () => {
    const original = {
      placeId: "abc123", name: "Dr. Rao Skin Clinic", doctorType: "Dermatologist",
      address: "Sector 62, Noida", area: "Sector 62", city: "Noida",
      phone: "9876543210", website: "", mapsUrl: "https://maps.example/abc",
      rating: 4.6, reviewCount: 210, latitude: 28.62, longitude: 77.37, distanceKm: 3.2
    };
    const parsed = fromExcelRow(toExcelRow(original) as unknown as Record<string, unknown>);
    expect(parsed).toMatchObject({
      name: "Dr. Rao Skin Clinic",
      googlePlaceId: "abc123",
      phone: "9876543210",
      city: "Noida",
      latitude: 28.62,
      longitude: 77.37
    });
  });

  it("skips rows with no doctor name instead of importing blanks", () => {
    expect(fromExcelRow({ "Doctor Name": "  ", City: "Noida" })).toBeNull();
  });

  it("accepts a hand-made sheet that has no Place ID", () => {
    const parsed = fromExcelRow({ "Doctor Name": "Dr. Sharma", City: "Ghaziabad", Latitude: "28.67", Longitude: "77.43" });
    expect(parsed?.googlePlaceId).toBeUndefined();
    expect(parsed?.latitude).toBe(28.67);
  });
});
