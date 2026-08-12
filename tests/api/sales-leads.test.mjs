/**
 * Lead prospecting, end to end.
 *
 * The unit tests cover the mapping and the schemas; this covers the part only a
 * database can answer — that a second sweep of the same area updates the rows
 * already held instead of filing them twice, and that it does not overwrite the
 * status somebody set after ringing the place.
 *
 * The search endpoint is deliberately only exercised where it *fails*. A valid
 * search calls Google Places, which is billed, and a test suite that quietly
 * runs up a quota bill every time somebody pushes is a bad trade for the one
 * assertion it would buy.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { as, anonymous } from "../support/client.mjs";

const PREFIX = "__leadtest__";
const placeId = (suffix) => `${PREFIX}${suffix}`;

const lead = (suffix, over = {}) => ({
  placeId: placeId(suffix),
  name: `${PREFIX} Glow Parlour ${suffix}`,
  type: "Beauty parlour test",
  address: "12 Nehru Nagar, Ghaziabad",
  area: "Nehru Nagar",
  city: "Ghaziabad Test",
  phone: "098765 43210",
  website: "",
  mapsUrl: "https://maps.google.com/?cid=1",
  rating: 4.6,
  reviewCount: 231,
  ...over
});

let admin, hr, mr;

/** Everything this file created, removed however the run ended. */
async function sweep() {
  const result = await admin.get("/api/sales/leads?limit=100&q=" + encodeURIComponent(PREFIX));
  for (const row of result.data?.items ?? []) await admin.delete(`/api/sales/leads/${row._id}`);
}

beforeAll(async () => {
  [admin, hr, mr] = await Promise.all([as("ADMIN"), as("HR"), as("MR")]);
  await sweep();
});

afterAll(async () => {
  await sweep();
});

describe("who may prospect", () => {
  it("refuses anybody who is not signed in", async () => {
    const result = await anonymous().get("/api/sales/leads");
    expect(result.status).toBe(401);
  });

  it("keeps field staff out of the affiliate operation entirely", async () => {
    expect((await mr.get("/api/sales/leads")).status).toBe(403);
    expect((await mr.post("/api/sales/leads", { leads: [lead("mr")] })).status).toBe(403);
  });

  it("lets HR read the list but not spend the Google quota or write to it", async () => {
    expect((await hr.get("/api/sales/leads")).status).toBe(200);
    expect((await hr.post("/api/sales/leads/search", {
      query: "beauty parlour", location: "Ghaziabad", type: "Beauty parlour"
    })).status).toBe(403);
    expect((await hr.post("/api/sales/leads", { leads: [lead("hr")] })).status).toBe(403);
  });
});

describe("POST /api/sales/leads/search", () => {
  it("refuses a search with no type before it costs anything", async () => {
    const result = await admin.post("/api/sales/leads/search", {
      query: "beauty parlour", location: "Ghaziabad"
    });
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/type/i);
  });

  it("refuses to promise more results than Google will return", async () => {
    const result = await admin.post("/api/sales/leads/search", {
      query: "gym", location: "Noida", type: "Gym", resultLimit: 500
    });
    expect(result.status).toBe(400);
  });
});

describe("POST /api/sales/leads", () => {
  it("saves what was picked, under the type it was filed as", async () => {
    const result = await admin.post("/api/sales/leads", {
      leads: [lead("a"), lead("b")],
      searchQuery: "beauty parlour",
      searchLocation: "Ghaziabad"
    });
    expect(result.status).toBe(201);
    expect(result.data).toMatchObject({ created: 2, updated: 0 });

    const list = await admin.get(`/api/sales/leads?q=${encodeURIComponent(PREFIX)}`);
    expect(list.data.total).toBe(2);
    const saved = list.data.items.find(row => row.googlePlaceId === placeId("a"));
    expect(saved).toMatchObject({
      type: "Beauty parlour test",
      status: "New",
      source: "Google",
      googleMapsUrl: "https://maps.google.com/?cid=1",
      searchQuery: "beauty parlour"
    });
  });

  it("refuses an empty batch", async () => {
    expect((await admin.post("/api/sales/leads", { leads: [] })).status).toBe(400);
  });

  it("updates rather than duplicates when the same area is swept again", async () => {
    const again = await admin.post("/api/sales/leads", {
      leads: [lead("a", { phone: "011 4000 0000" }), lead("b")]
    });
    expect(again.data).toMatchObject({ created: 0, updated: 2 });

    const list = await admin.get(`/api/sales/leads?q=${encodeURIComponent(PREFIX)}`);
    expect(list.data.total).toBe(2);
    expect(list.data.items.find(row => row.googlePlaceId === placeId("a")).phone).toBe("011 4000 0000");
  });

  it("never overwrites what a person knows with what Google says", async () => {
    const list = await admin.get(`/api/sales/leads?q=${encodeURIComponent(PREFIX)}`);
    const row = list.data.items.find(item => item.googlePlaceId === placeId("a"));

    await admin.patch(`/api/sales/leads/${row._id}`, {
      status: "Interested", notes: "Owner wants a sample kit", type: "Salon test"
    });
    // The same sweep again, still calling it a beauty parlour.
    await admin.post("/api/sales/leads", { leads: [lead("a")] });

    const after = await admin.get(`/api/sales/leads?q=${encodeURIComponent(PREFIX)}`);
    const kept = after.data.items.find(item => item.googlePlaceId === placeId("a"));
    expect(kept.status).toBe("Interested");
    expect(kept.notes).toBe("Owner wants a sample kit");
    expect(kept.type).toBe("Salon test");
  });
});

describe("GET /api/sales/leads", () => {
  it("filters by type, and counts the statuses before the status filter narrows them", async () => {
    const byType = await admin.get(`/api/sales/leads?type=${encodeURIComponent("Salon test")}`);
    expect(byType.data.items.every(row => row.type === "Salon test")).toBe(true);

    const filtered = await admin.get(`/api/sales/leads?q=${encodeURIComponent(PREFIX)}&status=New`);
    expect(filtered.data.items.every(row => row.status === "New")).toBe(true);
    // One is Interested and is not on the page, but is still counted — that
    // count is what the filter's own label reads.
    expect(filtered.data.counts.Interested).toBe(1);
    expect(filtered.data.counts.New).toBe(1);
  });

  it("offers every type ever saved, so the filter matches what is there", async () => {
    const result = await admin.get("/api/sales/leads");
    expect(result.data.types).toEqual(expect.arrayContaining(["Salon test", "Beauty parlour test"]));
  });

  it("caps the page size, so a caller cannot ask for the whole table", async () => {
    const result = await admin.get("/api/sales/leads?limit=100000");
    expect(result.data.items.length).toBeLessThanOrEqual(100);
  });
});

describe("PATCH /api/sales/leads/[id]", () => {
  let id;

  beforeAll(async () => {
    const list = await admin.get(`/api/sales/leads?q=${encodeURIComponent(PREFIX)}`);
    id = list.data.items.find(row => row.googlePlaceId === placeId("b"))._id;
  });

  it("moves a lead along, and lets a note be cleared", async () => {
    expect((await admin.patch(`/api/sales/leads/${id}`, { status: "Contacted" })).data.status).toBe("Contacted");
    expect((await admin.patch(`/api/sales/leads/${id}`, { notes: "" })).status).toBe(200);
  });

  it("refuses a status that is not one of the four", async () => {
    expect((await admin.patch(`/api/sales/leads/${id}`, { status: "Nearly" })).status).toBe(400);
  });

  it("refuses a change that changes nothing, and a type emptied by accident", async () => {
    expect((await admin.patch(`/api/sales/leads/${id}`, {})).status).toBe(400);
    expect((await admin.patch(`/api/sales/leads/${id}`, { type: "" })).status).toBe(400);
  });

  it("tells a caller a malformed or missing id apart", async () => {
    expect((await admin.patch("/api/sales/leads/not-an-id", { status: "New" })).status).toBe(400);
    expect((await admin.patch("/api/sales/leads/0123456789abcdef01234567", { status: "New" })).status).toBe(404);
  });
});

describe("DELETE /api/sales/leads/[id]", () => {
  it("removes a lead outright, and says so only once", async () => {
    const list = await admin.get(`/api/sales/leads?q=${encodeURIComponent(PREFIX)}`);
    const id = list.data.items[0]._id;

    expect((await admin.delete(`/api/sales/leads/${id}`)).status).toBe(200);
    expect((await admin.delete(`/api/sales/leads/${id}`)).status).toBe(404);
  });

  it("is not something HR may do", async () => {
    const list = await admin.get(`/api/sales/leads?q=${encodeURIComponent(PREFIX)}`);
    expect((await hr.delete(`/api/sales/leads/${list.data.items[0]._id}`)).status).toBe(403);
  });
});
