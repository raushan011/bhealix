import { describe, expect, it } from "vitest";
import { assessRto, dueOn, followUpBucket, isOutForDelivery, needsAction } from "./risk";

const address = { address1: "Flat 12, Sunrise Apartments, Boring Road", city: "Patna", pinCode: "800001" };

describe("assessRto", () => {
  it("rates a prepaid repeat customer low", () => {
    const result = assessRto({ paymentMode: "Prepaid", total: 1500, address, phone: { delivered: 2, returned: 0 } });
    expect(result.level).toBe("Low");
    expect(result.reasons.join(" ")).toMatch(/Repeat customer/);
  });

  it("rates a first COD order to a returning pin code high, and says why", () => {
    const result = assessRto({ paymentMode: "COD", total: 3500, address, pin: { delivered: 2, returned: 4 } });
    expect(result.level).toBe("High");
    expect(result.reasons).toEqual(expect.arrayContaining([
      "Cash on delivery — nothing paid up front.",
      "This pin code returned 4 of its last 6 parcels.",
      "A high-value order collected in cash."
    ]));
    expect(result.advice).toMatch(/advance or prepaid/);
  });

  it("weighs a customer's own returns above everything", () => {
    const result = assessRto({ paymentMode: "COD", total: 900, address, phone: { delivered: 1, returned: 2 } });
    expect(result.level).toBe("High");
    expect(result.reasons.join(" ")).toMatch(/returned 2 of 3/);
  });

  it("ignores a pin code with too little history to mean anything", () => {
    const result = assessRto({ paymentMode: "Prepaid", total: 900, address, pin: { delivered: 0, returned: 2 } });
    expect(result.reasons.join(" ")).not.toMatch(/pin code/);
  });

  it("flags an address a courier cannot find", () => {
    expect(assessRto({ paymentMode: "Prepaid", total: 900, address: { address1: "Near temple" } }).reasons.join(" ")).toMatch(/very short/);
    expect(assessRto({ paymentMode: "Prepaid", total: 900, address: { address1: "Behind the big temple on station road" } }).reasons.join(" ")).toMatch(/no house/);
  });

  it("treats an undeliverable pin code, or no cash collection on COD, as serious", () => {
    expect(assessRto({ paymentMode: "Prepaid", total: 900, address, serviceability: { deliverable: false, cod: false } }).reasons.join(" ")).toMatch(/No courier/);
    expect(assessRto({ paymentMode: "COD", total: 900, address, serviceability: { deliverable: true, cod: false } }).level).toBe("High");
  });

  it("keeps the score between 0 and 100", () => {
    const result = assessRto({ paymentMode: "COD", total: 9000, address: {}, phone: { delivered: 0, returned: 5 }, pin: { delivered: 0, returned: 9 }, serviceability: { deliverable: false, cod: false } });
    expect(result.score).toBe(100);
  });
});

describe("delivery-day rules", () => {
  it("recognises out-for-delivery however the courier spells it", () => {
    expect(isOutForDelivery("OUT FOR DELIVERY")).toBe(true);
    expect(isOutForDelivery("Out_For_Delivery")).toBe(true);
    expect(isOutForDelivery("IN TRANSIT")).toBe(false);
  });

  it("recognises a failed attempt waiting for instructions", () => {
    expect(needsAction("UNDELIVERED")).toBe(true);
    expect(needsAction("NDR Raised")).toBe(true);
    expect(needsAction("In transit", "Undelivered")).toBe(true);
    expect(needsAction("DELIVERED", "Delivered")).toBe(false);
  });

  it("matches an expected delivery to a calendar day", () => {
    expect(dueOn("2026-10-03 18:00:00", "2026-10-03")).toBe(true);
    expect(dueOn(null, "2026-10-03")).toBe(false);
  });

  it("buckets follow-ups against today", () => {
    expect(followUpBucket("2026-10-01", "2026-10-03")).toBe("Overdue");
    expect(followUpBucket("2026-10-03", "2026-10-03")).toBe("Today");
    expect(followUpBucket("2026-10-09", "2026-10-03")).toBe("Upcoming");
  });
});
