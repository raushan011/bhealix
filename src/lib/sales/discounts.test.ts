import { describe, expect, it } from "vitest";
import { DISCOUNT_FIELDS, DISCOUNT_TYPES, isLive } from "./discounts";

/**
 * The query cannot be run without a shop, so what is pinned here is the thing
 * that actually went wrong: a field name that does not exist on the type.
 *
 * GraphQL rejects the **whole** query for one bad name rather than returning
 * what it could — so `usageCount` in place of `asyncUsageCount` did not mean a
 * missing column, it meant an empty coupon list and no visible reason why.
 */
describe("the discount query fragment", () => {
  it("asks for the async usage count, which is the one that exists", () => {
    expect(DISCOUNT_FIELDS).toContain("asyncUsageCount");
    expect(DISCOUNT_FIELDS.replace(/asyncUsageCount/g, "")).not.toContain("usageCount");
  });

  it("takes Shopify's own summary rather than rebuilding one", () => {
    // `customerGets.value` is a union inside a union — three more ways to get
    // this wrong for a sentence Shopify already writes.
    expect(DISCOUNT_FIELDS).toContain("summary");
    expect(DISCOUNT_FIELDS).not.toContain("customerGets");
  });

  it("reads the codes, since a discount is useless here without them", () => {
    expect(DISCOUNT_FIELDS).toMatch(/codes\(first: \d+\)/);
    expect(DISCOUNT_FIELDS).toContain("node { code }");
  });

  it("covers every code discount type a shop can have", () => {
    expect([...DISCOUNT_TYPES]).toEqual(["DiscountCodeBasic", "DiscountCodeBxgy", "DiscountCodeFreeShipping"]);
  });
});

describe("isLive", () => {
  it("is true only for a code somebody could still use", () => {
    expect(isLive("ACTIVE")).toBe(true);
    expect(isLive("active")).toBe(true);
    expect(isLive("EXPIRED")).toBe(false);
    expect(isLive("SCHEDULED")).toBe(false);
    // A code only ever seen on an order — Shopify has not been asked about it.
    expect(isLive("Unknown")).toBe(false);
  });
});
