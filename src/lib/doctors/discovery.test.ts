import { describe, expect, it } from "vitest";
import { discoverySchema, fromExcelRow, toExcelRow } from "./discovery";

describe("discovery input", () => {
  it("caps the search radius at 100 km", () => {
    expect(discoverySchema.safeParse({ location: "Noida", radiusKm: 101, doctorTypes: ["Dermatologist"] }).success).toBe(false);
    expect(discoverySchema.safeParse({ location: "Noida", radiusKm: 100, doctorTypes: ["Dermatologist"] }).success).toBe(true);
  });

  it("requires at least one doctor type", () => {
    expect(discoverySchema.safeParse({ location: "Noida", radiusKm: 10, doctorTypes: [] }).success).toBe(false);
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
