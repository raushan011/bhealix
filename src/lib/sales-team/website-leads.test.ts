import { describe, expect, it } from "vitest";
import { cartRemark, cartSummary, executiveRows, websiteLeadSchema } from "./website-leads";

describe("websiteLeadSchema", () => {
  it("reads what the leads sheet sends, down to ten digits", () => {
    const lead = websiteLeadSchema.parse({
      name: "  Priya  ", phone: "+919876543210", product: "Anti-Pigmentation Kit", variant: "46883529031910", qty: "2",
      page: "https://www.bhealix.com/products/kit", source: "facebook / summer-sale"
    });
    expect(lead).toMatchObject({ name: "Priya", phone: "9876543210", qty: 2, source: "facebook / summer-sale" });
  });

  it("refuses a number that is not an Indian mobile", () => {
    expect(() => websiteLeadSchema.parse({ name: "A", phone: "12345" })).toThrow();
    expect(() => websiteLeadSchema.parse({ name: "A", phone: "+915876543210" })).toThrow();
  });

  it("keeps the number when the rest is odd", () => {
    const lead = websiteLeadSchema.parse({ name: "A", phone: "9876543210", qty: "lots", variant: 4688 });
    expect(lead).toMatchObject({ phone: "9876543210", qty: 1, variant: "4688" });
    expect(lead.product).toBeUndefined();
  });
});

describe("cart wording", () => {
  it("summarises the latest cart", () => {
    expect(cartSummary({ lastProduct: "Face Wash", count: 3, lastSource: "facebook" })).toBe("Face Wash · 3 adds · via facebook");
    expect(cartSummary({ lastProduct: "Face Wash", count: 1, lastSource: "direct" })).toBe("Face Wash");
    expect(cartSummary(undefined)).toBe("");
  });

  it("writes the timeline remark", () => {
    expect(cartRemark({ product: "Sunscreen", qty: 2, source: "direct" }, false)).toBe("Added to cart on the website: Sunscreen × 2.");
    expect(cartRemark({ qty: 1, source: "instagram" }, true)).toBe("Added to cart again on the website: a product (via instagram).");
  });
});

describe("executiveRows", () => {
  it("folds statuses per executive, unassigned first, busiest next", () => {
    const rows = executiveRows([
      { _id: { executive: "a", status: "New" }, count: 1, user: [{ name: "Asha" }] },
      { _id: { status: "New" }, count: 4 },
      { _id: { executive: "b", status: "Contacted" }, count: 2, user: [{ name: "Bilal" }] },
      { _id: { executive: "b", status: "Converted" }, count: 1, user: [{ name: "Bilal" }] }
    ]);
    expect(rows.map(row => [row.name, row.total])).toEqual([["Not assigned", 4], ["Bilal", 3], ["Asha", 1]]);
    expect(rows[1].counts).toEqual({ Contacted: 2, Converted: 1 });
  });
});
