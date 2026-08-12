import { describe, expect, it } from "vitest";
import type { Place } from "@/lib/doctors/places";
import {
  MAX_LEAD_RESULTS, leadSearchPages, leadSearchSchema, leadUpdateSchema, toLead, toLeadFields
} from "./leads";

const place = (over: Partial<Place> = {}): Place => ({
  id: "places/abc",
  displayName: { text: "Glow Beauty Parlour" },
  formattedAddress: "12 Nehru Nagar, Ghaziabad, Uttar Pradesh 201001",
  location: { latitude: 28.66, longitude: 77.43 },
  rating: 4.6,
  userRatingCount: 231,
  nationalPhoneNumber: "098765 43210",
  googleMapsUri: "https://maps.google.com/?cid=1",
  addressComponents: [
    { longText: "Nehru Nagar", types: ["sublocality_level_1", "sublocality"] },
    { longText: "Ghaziabad", types: ["locality"] }
  ],
  ...over
});

describe("toLead", () => {
  it("reads a place into a lead under the type that was asked for", () => {
    const lead = toLead(place(), "Beauty parlour");
    expect(lead).toMatchObject({
      placeId: "places/abc",
      name: "Glow Beauty Parlour",
      type: "Beauty parlour",
      area: "Nehru Nagar",
      city: "Ghaziabad",
      phone: "098765 43210",
      rating: 4.6,
      reviewCount: 231
    });
  });

  it("keeps a place with no coordinates", () => {
    // The point of the whole difference from doctor discovery: nothing routes a
    // lead, so a shopfront Google has not pinned is still worth ringing.
    const lead = toLead(place({ location: undefined }), "Salon");
    expect(lead?.name).toBe("Glow Beauty Parlour");
    expect(lead?.latitude).toBeUndefined();
  });

  it("falls back to a readable name and empty strings rather than undefined", () => {
    const lead = toLead({ id: "places/bare" }, "Gym");
    expect(lead).toMatchObject({ name: "Unnamed business", address: "", area: "", city: "", phone: "" });
  });

  it("refuses a place with no id, because there would be nothing to dedupe on", () => {
    expect(toLead({ id: "" }, "Gym")).toBeNull();
  });
});

describe("toLeadFields", () => {
  it("renames the two fields a spread would silently drop", () => {
    const fields = toLeadFields({
      placeId: "places/abc", name: "Glow", type: "Beauty parlour",
      address: "", area: "", city: "", phone: "", website: "", mapsUrl: "https://maps.google.com/?cid=1"
    });
    expect(fields.googlePlaceId).toBe("places/abc");
    expect(fields.googleMapsUrl).toBe("https://maps.google.com/?cid=1");
    expect(fields).not.toHaveProperty("placeId");
    expect(fields).not.toHaveProperty("mapsUrl");
  });
});

describe("leadSearchSchema", () => {
  const valid = { query: "beauty parlour", location: "Ghaziabad", type: "Beauty parlour", resultLimit: 40 };

  it("accepts a whole search", () => {
    expect(leadSearchSchema.parse(valid)).toMatchObject(valid);
  });

  it("insists on a type, because it is what makes the list findable again", () => {
    const parsed = leadSearchSchema.safeParse({ ...valid, type: " " });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0].message).toContain("type");
  });

  it("refuses to promise more results than Google will ever return", () => {
    expect(leadSearchSchema.safeParse({ ...valid, resultLimit: MAX_LEAD_RESULTS + 20 }).success).toBe(false);
  });

  it("defaults the limit rather than failing when it is not given", () => {
    expect(leadSearchSchema.parse({ query: "gym", location: "Noida", type: "Gym" }).resultLimit).toBe(20);
  });
});

describe("leadSearchPages", () => {
  it("asks for only the pages a limit needs — each one is a billed request", () => {
    expect(leadSearchPages(5)).toBe(1);
    expect(leadSearchPages(20)).toBe(1);
    expect(leadSearchPages(21)).toBe(2);
    expect(leadSearchPages(60)).toBe(3);
  });

  it("never asks for a fourth page, because there is not one", () => {
    expect(leadSearchPages(500)).toBe(3);
  });
});

describe("leadUpdateSchema", () => {
  it("takes a status on its own", () => {
    expect(leadUpdateSchema.parse({ status: "Contacted" })).toEqual({ status: "Contacted" });
  });

  it("allows a note to be cleared but not a type", () => {
    expect(leadUpdateSchema.parse({ notes: "" }).notes).toBe("");
    expect(leadUpdateSchema.safeParse({ type: "" }).success).toBe(false);
  });

  it("refuses an empty change", () => {
    expect(leadUpdateSchema.safeParse({}).success).toBe(false);
  });
});
