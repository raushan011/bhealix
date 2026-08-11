import { describe, expect, it } from "vitest";
import { toDateInput } from "@/lib/time";
import { attributeOrder, couponFor, isRepCode, normaliseCode, parseCoupon } from "./coupons";
import {
  commissionState, computeCommission, needsReversal, netOf, nextStatus, recalculateCommission,
  type CommissionOrderLike, type CommissionRule, type OrderLine
} from "./commission";

/** The two rules the business actually runs on. */
const KIT30: CommissionRule = { suffix: "30", label: "Pigmentation kit", rate: 30, base: "Discounted lines", products: [], active: true };
const SINGLE10: CommissionRule = { suffix: "10", label: "Single product", rate: 10, base: "Discounted lines", products: [], active: true };

const line = (over: Partial<OrderLine> = {}): OrderLine =>
  ({ title: "Skin pigmentation kit", quantity: 1, gross: 2299, couponDiscount: 0, otherDiscount: 0, refunded: 0, ...over });

describe("parseCoupon", () => {
  it("splits a rep's code from the rule the digits name", () => {
    expect(parseCoupon("RAUSHAN30")).toEqual({ repCode: "RAUSHAN", suffix: "30" });
    expect(parseCoupon("raushan10")).toEqual({ repCode: "RAUSHAN", suffix: "10" });
    expect(parseCoupon("  Priya30  ")).toEqual({ repCode: "PRIYA", suffix: "30" });
  });

  it("reads a name carrying its own digits without eating them", () => {
    expect(parseCoupon("RAUSHAN2K30")).toEqual({ repCode: "RAUSHAN2K", suffix: "30" });
  });

  it("refuses anything that is not a name followed by digits", () => {
    expect(parseCoupon("FREESHIP")).toBeNull();
    expect(parseCoupon("30")).toBeNull();
    expect(parseCoupon("")).toBeNull();
    expect(parseCoupon(null)).toBeNull();
  });
});

describe("coupon codes", () => {
  it("builds the pair a rep is given", () => {
    expect(couponFor("raushan", "10")).toBe("RAUSHAN10");
    expect(couponFor("RAUSHAN", "30")).toBe("RAUSHAN30");
  });

  it("accepts a rep code fit to read out over the phone, and no other", () => {
    expect(isRepCode("RAUSHAN")).toBe(true);
    expect(isRepCode("priya_k")).toBe(true);
    expect(isRepCode("R")).toBe(false);          // too short to be anybody's name
    expect(isRepCode("2FAST")).toBe(false);      // a code starting with a digit cannot be split back out
    expect(isRepCode("RAM KUMAR")).toBe(false);  // a space in a coupon code is a support call
  });
});

describe("attributeOrder", () => {
  const known = new Map([["RAUSHAN30", "rep-1"], ["PRIYA10", "rep-2"]]);

  it("finds the rep behind a code, whatever case Shopify sends it in", () => {
    expect(attributeOrder(["raushan30"], known)).toEqual({ code: "RAUSHAN30", repId: "rep-1" });
  });

  it("ignores a site-wide offer stacked alongside it", () => {
    expect(attributeOrder(["DIWALI25", "PRIYA10"], known)).toEqual({ code: "PRIYA10", repId: "rep-2" });
  });

  it("attributes nothing when no code belongs to a rep", () => {
    expect(attributeOrder(["DIWALI25"], known)).toBeNull();
    expect(attributeOrder([], known)).toBeNull();
  });
});

describe("computeCommission", () => {
  it("pays ₹450 on the kit — 30% of the ₹1499 actually received", () => {
    const result = computeCommission([line({ couponDiscount: 800 })], KIT30);
    expect(result.base).toBe(1499);
    expect(result.amount).toBe(450);   // 449.7 rounded to the rupee it is paid in
  });

  it("pays 10% of what was paid after the 10% came off", () => {
    const result = computeCommission([line({ title: "Face wash", gross: 1000, couponDiscount: 100 })], SINGLE10);
    expect(result.base).toBe(900);
    expect(result.amount).toBe(90);
  });

  it("pays only on the lines the coupon actually discounted", () => {
    const result = computeCommission([
      line({ title: "Face wash", gross: 1000, couponDiscount: 100 }),
      line({ title: "Sunscreen", gross: 800 })   // the code did not apply here
    ], SINGLE10);
    expect(result.base).toBe(900);
    expect(result.lines).toHaveLength(1);
    expect(result.wholeOrderFallback).toBe(false);
  });

  it("does not call a single line a fallback — it is the only line the coupon could have hit", () => {
    const result = computeCommission([line({ gross: 1499 })], KIT30);
    expect(result.base).toBe(1499);
    expect(result.wholeOrderFallback).toBe(false);
  });

  it("counts the whole order, and says so, when several lines carry no allocation", () => {
    const result = computeCommission([line({ gross: 1499 }), line({ title: "Face wash", gross: 599 })], KIT30);
    expect(result.wholeOrderFallback).toBe(true);
    expect(result.base).toBe(2098);
  });

  it("takes a stacked offer off the base as well — it is money that never arrived", () => {
    const result = computeCommission([line({ couponDiscount: 800, otherDiscount: 99 })], KIT30);
    expect(result.base).toBe(1400);
    expect(result.amount).toBe(420);
  });

  it("takes a partial refund off the base", () => {
    const result = computeCommission([line({ couponDiscount: 800, refunded: 499 })], KIT30);
    expect(result.base).toBe(1000);
    expect(result.amount).toBe(300);
  });

  it("pays on every unit of a multiple-kit order", () => {
    const result = computeCommission([line({ quantity: 2, gross: 4598, couponDiscount: 1600 })], KIT30);
    expect(result.base).toBe(2998);
    expect(result.amount).toBe(899);   // 899.4 — two kits, to the rupee
  });

  it("never turns a line into a credit", () => {
    expect(netOf(line({ gross: 500, couponDiscount: 800 }))).toBe(0);
    expect(computeCommission([line({ gross: 500, couponDiscount: 800 })], KIT30).amount).toBe(0);
  });

  it("pays on a named product when the rule is kept as a list", () => {
    const rule: CommissionRule = { ...KIT30, base: "Named products", products: ["KIT-PIG-01"] };
    const result = computeCommission([
      line({ sku: "KIT-PIG-01", couponDiscount: 800 }),
      line({ sku: "FW-200", title: "Face wash", gross: 1000 })
    ], rule);
    expect(result.base).toBe(1499);
  });
});

describe("commissionState", () => {
  const delivered = new Date("2026-08-01T10:00:00");
  const base = { amount: 450, holdDays: 7, deliveredAt: delivered } as const;

  it("owes nothing while the parcel is still out", () => {
    const state = commissionState({ ...base, delivery: "In transit", now: new Date("2026-08-02T10:00:00") });
    expect(state.status).toBe("Pending");
  });

  it("holds a delivered order for seven days", () => {
    const state = commissionState({ ...base, delivery: "Delivered", now: new Date("2026-08-05T10:00:00") });
    expect(state.status).toBe("Maturing");
    expect(toDateInput(state.maturesAt!)).toBe("2026-08-08");
  });

  it("becomes payable the moment the hold elapses", () => {
    expect(commissionState({ ...base, delivery: "Delivered", now: new Date("2026-08-08T10:00:00") }).status).toBe("Payable");
    expect(commissionState({ ...base, delivery: "Delivered", now: new Date("2026-08-08T09:59:59") }).status).toBe("Maturing");
  });

  it("pays nothing on a parcel that came back", () => {
    for (const delivery of ["RTO", "Returned", "Cancelled", "Lost"] as const) {
      const state = commissionState({ ...base, delivery, now: new Date("2026-09-01T10:00:00") });
      expect(state.status).toBe("Void");
      expect(state.reason).toBeTruthy();
    }
  });

  it("pays nothing on an order cancelled or refunded in Shopify, whatever the courier says", () => {
    expect(commissionState({ ...base, delivery: "Delivered", cancelled: true }).status).toBe("Void");
    expect(commissionState({ ...base, delivery: "Delivered", fullyRefunded: true }).status).toBe("Void");
  });

  it("pays nothing where nothing was received", () => {
    expect(commissionState({ ...base, amount: 0, delivery: "Delivered" }).status).toBe("Void");
  });

  it("starts the clock at the moment we learned, when the courier gives no date", () => {
    const now = new Date("2026-08-10T10:00:00");
    const state = commissionState({ amount: 450, holdDays: 7, delivery: "Delivered", deliveredAt: null, now });
    expect(state.status).toBe("Maturing");
    expect(toDateInput(state.maturesAt!)).toBe("2026-08-17");
  });
});

describe("nextStatus", () => {
  it("leaves a commission a payout run has claimed exactly as it is", () => {
    expect(nextStatus("In payout", "Payable")).toBe("In payout");
    expect(nextStatus("Paid", "Void")).toBe("Paid");
  });

  it("moves anything a run has not claimed", () => {
    expect(nextStatus("Maturing", "Payable")).toBe("Payable");
    expect(nextStatus(undefined, "Pending")).toBe("Pending");
  });
});

describe("needsReversal", () => {
  it("flags money already promised on a parcel that has since come back", () => {
    expect(needsReversal("Paid", "Void")).toBe(true);
    expect(needsReversal("In payout", "Void")).toBe(true);
  });

  it("says nothing about a commission nobody has committed to yet", () => {
    expect(needsReversal("Payable", "Void")).toBe(false);
    expect(needsReversal("Paid", "Payable")).toBe(false);
  });
});

describe("normaliseCode", () => {
  it("is what every comparison goes through", () => {
    expect(normaliseCode("  raushan30 ")).toBe("RAUSHAN30");
  });
});

describe("recalculateCommission", () => {
  const order = (over: Partial<CommissionOrderLike> = {}): CommissionOrderLike => ({
    ruleSuffix: "30",
    items: [line({ couponDiscount: 800 })],
    shipment: { deliveredAt: new Date("2026-08-01T10:00:00") },
    delivery: { reported: "Delivered" },
    commission: {},
    ...over
  });

  const rules = [KIT30, SINGLE10];
  const later = { now: new Date("2026-08-20T10:00:00"), holdDays: 7 };

  it("prices a delivered order and makes it payable once the hold has passed", () => {
    const result = recalculateCommission(order(), rules, later);
    expect(result.commission.amount).toBe(450);
    expect(result.commission.base).toBe(1499);
    expect(result.commission.status).toBe("Payable");
    expect(result.delivery.state).toBe("Delivered");
  });

  it("lets a manual override beat what the courier said", () => {
    const result = recalculateCommission(
      order({ delivery: { reported: "Undelivered", override: "Delivered" } }), rules, later
    );
    expect(result.delivery.state).toBe("Delivered");
    expect(result.commission.status).toBe("Payable");
  });

  it("voids an order whose parcel came back, and says why", () => {
    const result = recalculateCommission(order({ delivery: { reported: "RTO" } }), rules, later);
    expect(result.commission.status).toBe("Void");
    expect(result.commission.reason).toMatch(/rto/i);
  });

  it("refuses to price a coupon no rule covers, rather than paying nothing quietly", () => {
    const result = recalculateCommission(order({ ruleSuffix: "20" }), rules, later);
    expect(result.commission.status).toBe("Void");
    expect(result.commission.reason).toMatch(/No commission rule/);
    expect(result.commission.amount).toBe(0);
  });

  it("leaves a commission a payout run has claimed exactly as the run priced it", () => {
    const claimed = order({ commission: { status: "Paid", amount: 450, base: 1499, rate: 30 } });
    // The rate has since been cut, and the parcel has since come back.
    const result = recalculateCommission(
      { ...claimed, delivery: { reported: "RTO" } },
      [{ ...KIT30, rate: 5 }],
      later
    );
    expect(result.commission.status).toBe("Paid");
    expect(result.commission.amount).toBe(450);
    expect(result.commission.needsReversal).toBe(true);
  });

  it("restates a commission no run has claimed when the rule changes", () => {
    const result = recalculateCommission(order({ commission: { status: "Payable", amount: 450 } }), [{ ...KIT30, rate: 20 }], later);
    expect(result.commission.amount).toBe(300);
    expect(result.commission.needsReversal).toBe(false);
  });

  it("holds a delivered order that is still inside the window", () => {
    const result = recalculateCommission(order(), rules, { now: new Date("2026-08-03T10:00:00"), holdDays: 7 });
    expect(result.commission.status).toBe("Maturing");
    expect(toDateInput(result.commission.maturesAt!)).toBe("2026-08-08");
  });
});
