import { describe, expect, it } from "vitest";
import type { Place } from "@/lib/doctors/places";
import {
  LEAD_QUERY_CEILING, MAX_LEAD_RESULTS, bulkLeadSchema, estimateLeadRequests, isOutreach,
  leadSaveSchema, leadSearchPages, leadSearchSchema, leadSearchZones, leadUpdateSchema, leadWhere, like,
  remarkEditSchema, remarkSchema, remarkTone, telUrl, toLead, toLeadFields, whatsappNumber,
  whatsappUrl, withLeadStatus
} from "./leads";
import { REMARK_PROJECTION, remarkStages } from "./remark-log";

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

  it("refuses to promise more results than the sweep will ever return", () => {
    expect(leadSearchSchema.safeParse({ ...valid, resultLimit: MAX_LEAD_RESULTS + 20 }).success).toBe(false);
    expect(leadSearchSchema.safeParse({ ...valid, resultLimit: MAX_LEAD_RESULTS }).success).toBe(true);
  });

  it("allows past the single-query ceiling, because the sweep covers it", () => {
    // 60 is what one query returns; the ring of sub-centres is what gets past
    // it, so the schema must not treat 60 as the end of the road.
    expect(MAX_LEAD_RESULTS).toBeGreaterThan(LEAD_QUERY_CEILING);
    expect(leadSearchSchema.safeParse({ ...valid, resultLimit: 200 }).success).toBe(true);
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

describe("leadSearchZones", () => {
  it("stays at one centre for a search a single query can answer", () => {
    expect(leadSearchZones(5)).toBe(1);
    expect(leadSearchZones(40)).toBe(1);
  });

  it("adds centres as the target grows past what one query returns", () => {
    expect(leadSearchZones(60)).toBe(2);
    expect(leadSearchZones(200)).toBe(5);
  });

  it("stops at sixteen, past which the extra centres only cost money", () => {
    expect(leadSearchZones(500)).toBe(13);
    expect(leadSearchZones(5000)).toBe(16);
  });
});

describe("estimateLeadRequests", () => {
  it("prices a small search at a single page", () => {
    expect(estimateLeadRequests(20)).toBe(1);
  });

  it("grows with the sweep, so the cost of asking for 500 is visible", () => {
    // 13 centres × 3 pages. Worth knowing before pressing Search, since every
    // one of those is billed.
    expect(estimateLeadRequests(500)).toBe(39);
  });
});

describe("whatsappNumber", () => {
  it("takes the shapes Google actually returns", () => {
    expect(whatsappNumber("096503 06893")).toBe("919650306893");
    expect(whatsappNumber("+91 96503 06893")).toBe("919650306893");
    expect(whatsappNumber("9650306893")).toBe("919650306893");
    expect(whatsappNumber("083680 85695")).toBe("918368085695");
  });

  it("drops the trunk zero, which is the commonest way one of these links dies", () => {
    // wa.me answers "phone number shared via url is invalid" for 91096503…
    expect(whatsappNumber("096503 06893")).not.toContain("910");
  });

  it("leaves an already-international number alone", () => {
    expect(whatsappNumber("919650306893")).toBe("919650306893");
  });

  it("handles a landline with an STD code", () => {
    expect(whatsappNumber("0120-4567890")).toBe("911204567890");
  });

  it("is nothing when there is no usable number", () => {
    expect(whatsappNumber("")).toBeNull();
    expect(whatsappNumber(null)).toBeNull();
    expect(whatsappNumber("No number")).toBeNull();
    expect(whatsappNumber("12345")).toBeNull();
  });
});

describe("whatsappUrl", () => {
  it("is a wa.me link, or nothing at all", () => {
    expect(whatsappUrl("096503 06893")).toBe("https://wa.me/919650306893");
    expect(whatsappUrl("")).toBeNull();
  });
});

describe("telUrl", () => {
  it("puts the country code on a local number, the way wa.me gets one", () => {
    expect(telUrl("098999 43298")).toBe("tel:+919899943298");
    expect(telUrl("+91 96503 06893")).toBe("tel:+919650306893");
  });

  it("agrees with the WhatsApp link about what the number is", () => {
    expect(telUrl("098999 43298")).toBe(`tel:+${whatsappNumber("098999 43298")}`);
  });

  it("refuses a number nothing could dial", () => {
    expect(telUrl("")).toBeNull();
    expect(telUrl("call the shop")).toBeNull();
    expect(telUrl(undefined)).toBeNull();
  });

  /**
   * The one case the two helpers deliberately part company. A number too odd to
   * normalise still dials from a desk phone, and a dead link on the row where
   * the number is the only thing anybody wants is worse than a half-right one —
   * whereas wa.me answers a malformed number with an error page.
   */
  it("still offers a call for a number WhatsApp will not take", () => {
    expect(whatsappUrl("0120-456")).toBeNull();
    expect(telUrl("0120-456")).toBe("tel:0120456");
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

const params = (query: string) => new URLSearchParams(query);

describe("what a filter means", () => {
  it("asks for nothing when nothing was chosen", () => {
    expect(leadWhere(params(""))).toEqual({});
  });

  it("matches a half-remembered name across every field it could be in", () => {
    const where = leadWhere(params("q=glow")) as { $and: { $or: Record<string, RegExp>[] }[] };
    expect(where.$and[0].$or.map(clause => Object.keys(clause)[0]))
      .toEqual(["name", "phone", "address", "area", "city"]);
  });

  it("defangs a search that would otherwise be a regex", () => {
    expect(like("a.b(c").test("axb(c")).toBe(false);
    expect(like("a.b(c").test("a.b(c")).toBe(true);
  });

  /**
   * `$and` rather than a bare `$or`, so a later condition cannot silently
   * overwrite the search — which would widen an export past the screen it was
   * taken from.
   */
  it("keeps the search and the other filters from overwriting each other", () => {
    const where = leadWhere(params("q=glow&type=Salon&city=Noida"));
    expect(where).toMatchObject({ type: "Salon", city: "Noida" });
    expect(where.$and).toHaveLength(1);
  });

  it("leaves status out, so the counts can be taken before it narrows anything", () => {
    expect(leadWhere(params("status=Contacted"))).toEqual({});
  });

  it("adds the status only when it is one", () => {
    expect(withLeadStatus({ type: "Salon" }, "Contacted")).toEqual({ type: "Salon", status: "Contacted" });
    expect(withLeadStatus({ type: "Salon" }, "Maybe")).toEqual({ type: "Salon" });
    expect(withLeadStatus({ type: "Salon" }, null)).toEqual({ type: "Salon" });
  });
});

describe("a remark", () => {
  it("takes what was said and where it left the lead", () => {
    expect(remarkSchema.parse({ text: " Rang, no answer. ", channel: "Call", status: "Contacted" }))
      .toEqual({ text: "Rang, no answer.", channel: "Call", status: "Contacted" });
  });

  it("is a note unless it says otherwise", () => {
    expect(remarkSchema.parse({ text: "Shut for Diwali" }).channel).toBe("Note");
  });

  it("refuses an empty one, and a channel nothing files under", () => {
    expect(remarkSchema.safeParse({ text: " " }).success).toBe(false);
    expect(remarkSchema.safeParse({ text: "Rang", channel: "Pigeon" }).success).toBe(false);
  });

  it("refuses an edit that changes nothing", () => {
    expect(remarkEditSchema.safeParse({}).success).toBe(false);
    expect(remarkEditSchema.safeParse({ text: "Rang twice" }).success).toBe(true);
  });

  /**
   * Only a channel that reached somebody moves the contact tally, and so only
   * one of these takes a lead out of the outreach queue. A note to self that
   * did would leave a parlour nobody ever messages.
   */
  it("knows which channels actually reached somebody", () => {
    expect(isOutreach("Call")).toBe(true);
    expect(isOutreach("WhatsApp")).toBe(true);
    expect(isOutreach("Visit")).toBe(true);
    expect(isOutreach("Note")).toBe(false);
  });

  it("colours a channel the same way everywhere", () => {
    expect(remarkTone("Call")).toBe("info");
    expect(remarkTone("WhatsApp")).toBe("success");
    expect(remarkTone("Note")).toBe("neutral");
    expect(remarkTone("Smoke signal")).toBe("neutral");
  });
});

describe("doing one thing to a batch", () => {
  const ids = ["a".repeat(24), "b".repeat(24)];

  it("takes a status for the whole selection", () => {
    expect(bulkLeadSchema.parse({ ids, action: "status", status: "Not interested" }).ids).toHaveLength(2);
  });

  it("will not set a status it was not given", () => {
    expect(bulkLeadSchema.safeParse({ ids, action: "status" }).success).toBe(false);
  });

  it("will not refile leads under a type it was not given", () => {
    expect(bulkLeadSchema.safeParse({ ids, action: "type" }).success).toBe(false);
    expect(bulkLeadSchema.safeParse({ ids, action: "type", type: "Salon" }).success).toBe(true);
  });

  it("needs no extra for a delete", () => {
    expect(bulkLeadSchema.safeParse({ ids, action: "delete" }).success).toBe(true);
  });

  it("refuses an empty selection and anything that is not an id", () => {
    expect(bulkLeadSchema.safeParse({ ids: [], action: "delete" }).success).toBe(false);
    expect(bulkLeadSchema.safeParse({ ids: ["nope"], action: "delete" }).success).toBe(false);
  });
});

describe("reading the remarks across every lead", () => {
  it("narrows the leads before unwinding them", () => {
    const { stages } = remarkStages(params("type=Salon&status=Interested"));
    expect(stages[0]).toEqual({ $match: { type: "Salon", status: "Interested" } });
    expect(stages[1]).toEqual({ $unwind: "$remarks" });
  });

  /**
   * The search has to reach the wording of the remark, which it cannot do
   * before the unwind — somebody searching "Diwali" wants the calls where
   * Diwali was mentioned, not the parlours with it in their name.
   */
  it("asks the search again after the unwind, against the remark too", () => {
    const { stages } = remarkStages(params("q=Diwali"));
    expect(stages[0]).toEqual({ $match: {} });
    const after = stages[2] as { $match: { $or: Record<string, unknown>[] } };
    expect(after.$match.$or.map(clause => Object.keys(clause)[0]))
      .toEqual(["name", "phone", "city", "remarks.text", "remarks.byName"]);
  });

  it("reads a date range as whole local days, both ends included", () => {
    const { stages } = remarkStages(params("from=2026-08-10&to=2026-08-12"));
    const range = stages.at(-1) as { $match: { "remarks.at": { $gte: Date; $lte: Date } } };
    expect(range.$match["remarks.at"].$gte).toEqual(new Date("2026-08-10T00:00:00"));
    expect(range.$match["remarks.at"].$lte).toEqual(new Date("2026-08-12T23:59:59.999"));
  });

  it("takes one end of the range without the other", () => {
    const { stages } = remarkStages(params("from=2026-08-10"));
    const range = stages.at(-1) as { $match: { "remarks.at": Record<string, Date> } };
    expect(Object.keys(range.$match["remarks.at"])).toEqual(["$gte"]);
  });

  /**
   * The channel is held back so the per-channel tallies can still say how many
   * calls and how many messages there were — folded in, every channel but the
   * selected one would report zero.
   */
  it("keeps the channel apart from the stages the tallies share", () => {
    const { stages, channel } = remarkStages(params("channel=Call"));
    expect(stages).toHaveLength(2);
    expect(channel).toEqual([{ $match: { "remarks.channel": "Call" } }]);
  });

  it("narrows by nothing when no channel was chosen", () => {
    expect(remarkStages(params("")).channel).toEqual([]);
  });

  it("hands back a row carrying the lead it belongs to", () => {
    expect(REMARK_PROJECTION._id).toBe("$remarks._id");
    expect(REMARK_PROJECTION.lead.name).toBe("$name");
  });
});

describe("leadSaveSchema", () => {
  const row = (extra: Record<string, unknown> = {}) =>
    ({ placeId: "p1", name: "Glow Beauty Studio", type: "Beauty parlour", phone: "096503 06893", ...extra });

  it("keeps a batch whole when one row's website is unusable", () => {
    // The Bulandshahar case: a four-hundred-character Facebook share link on
    // result 24 used to fail the save of the sixty-six rows around it.
    const monster = "https://facebook.com/share/" + "a".repeat(3000);
    const parsed = leadSaveSchema.parse({ leads: [row(), row({ placeId: "p2", website: monster })] });
    expect(parsed.leads).toHaveLength(2);
    expect(parsed.leads[1].website).toBe("");
    expect(parsed.leads[1].name).toBe("Glow Beauty Studio");
  });

  it("keeps a long-but-real share link now that the cap is a URL's practical ceiling", () => {
    const long = "https://facebook.com/profile?" + "utm=x&".repeat(60);
    expect(leadSaveSchema.parse({ leads: [row({ website: long })] }).leads[0].website).toBe(long);
  });

  it("drops the furniture, never the row: bad rating, half a coordinate, junk phone", () => {
    const parsed = leadSaveSchema.parse({
      leads: [row({ rating: 17, latitude: 213.4, longitude: 77.1, phone: "call the shop after 6 unless the owner is at the other branch" })]
    });
    expect(parsed.leads[0].rating).toBeUndefined();
    expect(parsed.leads[0].latitude).toBeUndefined();
    expect(parsed.leads[0].longitude).toBe(77.1);
    expect(parsed.leads[0].phone).toBe("");
  });

  it("trims an over-long name to fit rather than refusing it", () => {
    const parsed = leadSaveSchema.parse({ leads: [row({ name: "Glow ".repeat(60) })] });
    expect(parsed.leads[0].name).toHaveLength(160);
  });

  it("still refuses what makes a row meaningless — no name at all", () => {
    expect(() => leadSaveSchema.parse({ leads: [row({ name: "  " })] })).toThrow();
    expect(() => leadSaveSchema.parse({ leads: [] })).toThrow();
  });
});
