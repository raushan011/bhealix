import { describe, expect, it } from "vitest";
import { customerKeyOf, deliveryFromShopify, fulfilmentStateOf, shopOrderFilter, shopOrderSort } from "./retarget";

/**
 * The calling list's cutting tools. Tested because every filter reaches a
 * `$match`, and a filter that silently matches nothing is a desk that rings
 * nobody and thinks the list is done.
 */

describe("customerKeyOf", () => {
  it("treats the same phone written three ways as one customer", () => {
    expect(customerKeyOf({ phone: "098999 43298" }, "1")).toBe("p:919899943298");
    expect(customerKeyOf({ phone: "+91 98999 43298" }, "2")).toBe("p:919899943298");
    expect(customerKeyOf({ phone: "9899943298" }, "3")).toBe("p:919899943298");
  });

  it("falls back to the email, then to the order itself", () => {
    expect(customerKeyOf({ email: " Priya@Example.com " }, "9")).toBe("e:priya@example.com");
    expect(customerKeyOf({}, "9")).toBe("o:9");
  });
});

describe("fulfilmentStateOf", () => {
  it("reduces Shopify's word to three", () => {
    expect(fulfilmentStateOf("fulfilled")).toBe("Fulfilled");
    expect(fulfilmentStateOf("partial")).toBe("Partial");
    expect(fulfilmentStateOf(null)).toBe("Unfulfilled");
  });
});

describe("shopOrderFilter", () => {
  const params = (input: Record<string, string>) => new URLSearchParams(input);
  const now = new Date("2026-08-18T10:00:00");

  it("is empty when nothing is asked for", () => {
    expect(shopOrderFilter(params({}), now)).toEqual({});
  });

  it("cuts a month as a half-open range, and lets a month beat a date range", () => {
    const filter = shopOrderFilter(params({ month: "2026-05", from: "2026-01-01" }), now) as { placedAt: { $gte: Date; $lt: Date } };
    expect(filter.placedAt.$gte).toEqual(new Date(2026, 4, 1));
    expect(filter.placedAt.$lt).toEqual(new Date(2026, 5, 1));
  });

  it("reads a from/to range to the ends of the day", () => {
    const filter = shopOrderFilter(params({ from: "2026-05-01", to: "2026-05-31" }), now) as { placedAt: { $gte: Date; $lte: Date } };
    expect(filter.placedAt.$gte).toEqual(new Date("2026-05-01T00:00:00"));
    expect(filter.placedAt.$lte).toEqual(new Date("2026-05-31T23:59:59.999"));
  });

  it("refuses a status or delivery state it does not know", () => {
    expect(shopOrderFilter(params({ status: "Bogus", delivery: "Teleported" }), now)).toEqual({});
    expect(shopOrderFilter(params({ status: "Reordered", delivery: "Delivered" }), now))
      .toEqual({ "retarget.status": "Reordered", "delivery.state": "Delivered" });
  });

  it("finds a phone typed with spaces against a phone stored with dashes", () => {
    const filter = shopOrderFilter(params({ q: "98999 43298" }), now) as { $and: { $or: Record<string, RegExp>[] }[] };
    const phone = filter.$and[0].$or.find(clause => "customer.phone" in clause)!["customer.phone"];
    expect(phone.test("+91-98999-43298")).toBe(true);
    expect(phone.test("9899900000")).toBe(false);
  });

  it("answers the calling desk's own questions", () => {
    expect(shopOrderFilter(params({ remarks: "none" }), now)).toEqual({ "retarget.remarkCount": { $in: [0, null] } });
    expect(shopOrderFilter(params({ contacted: "never" }), now)).toEqual({ "retarget.lastContactedAt": null });
    expect(shopOrderFilter(params({ followUp: "due" }), now)).toEqual({ "retarget.nextFollowUpAt": { $lte: now } });
    expect(shopOrderFilter(params({ repeat: "yes" }), now)).toEqual({ customerOrders: { $gt: 1 } });
    expect(shopOrderFilter(params({ partner: "none" }), now)).toEqual({ rep: null });
  });
});

describe("shopOrderSort", () => {
  it("is newest first unless told otherwise, and never trusts an unknown key", () => {
    expect(shopOrderSort(null)).toEqual({ placedAt: -1, _id: -1 });
    expect(shopOrderSort("nonsense")).toEqual({ placedAt: -1, _id: -1 });
    expect(shopOrderSort("followUp")).toEqual({ "retarget.nextFollowUpAt": 1, placedAt: -1 });
  });
});

describe("deliveryFromShopify", () => {
  it("reads the courier's word as the shop heard it", () => {
    expect(deliveryFromShopify([{ shipment_status: "delivered", tracking_company: "Delhivery", tracking_number: "AWB1", updated_at: "2026-08-12T10:00:00Z" }]))
      .toMatchObject({ state: "Delivered", courier: "Delhivery", awb: "AWB1" });
    expect(deliveryFromShopify([{ shipment_status: "in_transit" }])?.state).toBe("In transit");
    expect(deliveryFromShopify([{ shipment_status: "attempted_delivery" }])?.state).toBe("Undelivered");
  });

  it("says nothing when the shop has nothing to say", () => {
    expect(deliveryFromShopify(undefined)).toBeNull();
    expect(deliveryFromShopify([{ status: "success", shipment_status: null }])).toBeNull();
    expect(deliveryFromShopify([{ status: "cancelled", shipment_status: "delivered" }])).toBeNull();
  });

  it("reads the newest live fulfilment when a parcel was sent twice", () => {
    const state = deliveryFromShopify([
      { shipment_status: "failure", updated_at: "2026-08-01T10:00:00Z" },
      { shipment_status: "delivered", updated_at: "2026-08-09T10:00:00Z" }
    ])?.state;
    expect(state).toBe("Delivered");
  });
});
