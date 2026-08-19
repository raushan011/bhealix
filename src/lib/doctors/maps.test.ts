import { describe, expect, it } from "vitest";
import { doctorMapsUrl } from "./maps";

describe("the maps link", () => {
  it("routes to the doctor's own pin first", () => {
    expect(doctorMapsUrl({ coordinates: [77.35, 28.64], fullAddress: "ignored" }))
      .toBe("https://www.google.com/maps/dir/?api=1&destination=28.64,77.35");
  });

  it("falls back to where the rep actually stood at check-in", () => {
    expect(doctorMapsUrl({ checkIn: { latitude: 28.6, longitude: 77.3 } }))
      .toBe("https://www.google.com/maps/dir/?api=1&destination=28.6,77.3");
  });

  it("searches by name and address when there is no point at all", () => {
    const url = doctorMapsUrl({ name: "Dr Sharma", clinicName: "Care Clinic", area: "Indirapuram", city: "Ghaziabad" });
    expect(url).toContain("maps/search");
    expect(url).toContain(encodeURIComponent("Care Clinic, Indirapuram, Ghaziabad"));
  });

  it("ignores a half-empty pin rather than routing to 0,0", () => {
    expect(doctorMapsUrl({ coordinates: [77.35], city: "Ghaziabad", name: "Dr X" })).toContain("maps/search");
  });

  it("returns nothing when the record holds nothing", () => {
    expect(doctorMapsUrl({})).toBeNull();
  });
});
