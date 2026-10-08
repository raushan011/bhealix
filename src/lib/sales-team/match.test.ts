import { describe, expect, it } from "vitest";
import { teamMatchKeys } from "./server";

describe("teamMatchKeys", () => {
  it("finds a Shopify-placed order under the shop's number, with or without #, and the CRM's own", () => {
    const keys = teamMatchKeys({ name: "#1042", ref: "BHX-SE-00042", orderNumber: 1042, shopifyOrderId: "6123456789" });
    expect(keys).toEqual(expect.arrayContaining(["1042", "#1042", "BHX-SE-00042", "6123456789"]));
    // The bare number is asked first: it is what Shiprocket's Shopify channel files most orders under.
    expect(keys[0]).toBe("1042");
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("finds a direct order under its CRM number alone", () => {
    expect(teamMatchKeys({ name: "BHX-SE-00007", ref: "BHX-SE-00007" })).toEqual(["BHX-SE-00007"]);
  });
});
