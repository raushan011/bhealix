import { describe, expect, it } from "vitest";
import {
  collectAmountOf, DEFAULT_INCENTIVE_RULES, describeRule, incentiveAmountOf, paymentProblem, priceIncentive, priceOrder,
  ruleFor, rulesTable, teamOrderNo
} from "./orders";

describe("priceOrder", () => {
  it("adds up the lines and takes the discount off the order", () => {
    const order = priceOrder([{ title: "Kit", quantity: 2, price: 999 }, { title: "Serum", quantity: 1, price: 501 }], 300);
    expect(order.gross).toBe(2499);
    expect(order.discount).toBe(300);
    expect(order.total).toBe(2199);
  });

  it("spreads the discount so the lines always add up to the total exactly", () => {
    // The booking code sends each line at gross less its share; a courier
    // collecting cash checks the lines against the total first.
    const order = priceOrder([{ title: "A", quantity: 1, price: 100 }, { title: "B", quantity: 1, price: 100 }, { title: "C", quantity: 1, price: 100 }], 100);
    const lines = order.lines.reduce((sum, line) => sum + line.gross - line.otherDiscount, 0);
    expect(Math.round(lines * 100) / 100).toBe(order.total);
    expect(order.lines.map(line => line.otherDiscount)).toEqual([33.33, 33.33, 33.34]);
  });

  it("never discounts below nothing", () => {
    expect(priceOrder([{ title: "A", quantity: 1, price: 100 }], 500).total).toBe(0);
  });

  it("drops a line with no product and rounds quantities to whole units", () => {
    const order = priceOrder([{ title: "", quantity: 1, price: 50 }, { title: "A", quantity: 2.4, price: 10 }]);
    expect(order.lines).toHaveLength(1);
    expect(order.lines[0].quantity).toBe(2);
    expect(order.total).toBe(20);
  });
});

describe("collecting and part payments", () => {
  it("collects nothing on prepaid, everything on COD, and the balance on a part payment", () => {
    expect(collectAmountOf("Prepaid", 1499)).toBe(0);
    expect(collectAmountOf("COD", 1499)).toBe(1499);
    expect(collectAmountOf("Partial", 1499, 200)).toBe(1299);
  });

  it("refuses a part payment that is really COD or really prepaid", () => {
    expect(paymentProblem("Partial", 1499, 0)).toMatch(/already paid/);
    expect(paymentProblem("Partial", 1499, 1499)).toMatch(/Prepaid/);
    expect(paymentProblem("Partial", 1499, 200)).toBeNull();
    expect(paymentProblem("COD", 0)).toMatch(/no value/);
  });
});

describe("incentive rules", () => {
  it("pays a percentage in whole rupees, or a flat sum", () => {
    expect(incentiveAmountOf({ enabled: true, type: "Percentage", value: 5 }, 1499)).toBe(75);
    expect(incentiveAmountOf({ enabled: true, type: "Flat", value: 100 }, 1499)).toBe(100);
    expect(incentiveAmountOf({ enabled: false, type: "Flat", value: 100 }, 1499)).toBe(0);
  });

  it("fills a missing mode from the defaults, so a stored table can never be short", () => {
    expect(ruleFor([], "COD")).toEqual(DEFAULT_INCENTIVE_RULES.find(rule => rule.mode === "COD"));
    expect(rulesTable([{ mode: "COD", enabled: false, type: "Flat", value: 0 }]).map(rule => rule.mode)).toEqual(["COD", "Prepaid", "Partial"]);
  });

  it("says what a rule pays in words", () => {
    expect(describeRule({ enabled: true, type: "Percentage", value: 5 })).toBe("5% of the order");
    expect(describeRule({ enabled: true, type: "Flat", value: 100 })).toBe("₹100 per order");
    expect(describeRule({ enabled: false, type: "Flat", value: 100 })).toBe("No incentive");
  });
});

describe("priceIncentive", () => {
  const rule = { enabled: true, type: "Percentage" as const, value: 4 };
  const base = { rule, base: 1500, cancelled: false, paid: false };

  it("is pending until delivered, then payable", () => {
    expect(priceIncentive({ ...base, delivery: "In transit" })).toMatchObject({ status: "Pending", amount: 60 });
    expect(priceIncentive({ ...base, delivery: "Delivered" })).toMatchObject({ status: "Payable", amount: 60 });
  });

  it("earns nothing on a parcel that came back, or an order cancelled", () => {
    expect(priceIncentive({ ...base, delivery: "RTO" })).toMatchObject({ status: "Void", amount: 0 });
    expect(priceIncentive({ ...base, delivery: "Awaiting", cancelled: true })).toMatchObject({ status: "Void", amount: 0 });
  });

  it("records a switched-off mode as not eligible rather than as a pending zero", () => {
    expect(priceIncentive({ ...base, rule: { ...rule, enabled: false }, delivery: "Delivered" }).status).toBe("Not eligible");
  });

  it("never restates a paid incentive, and flags one whose parcel came back", () => {
    expect(priceIncentive({ ...base, paid: true, delivery: "Delivered" })).toMatchObject({ status: "Paid", needsReversal: false });
    expect(priceIncentive({ ...base, paid: true, delivery: "RTO" })).toMatchObject({ status: "Paid", needsReversal: true });
  });
});

describe("teamOrderNo", () => {
  it("is padded and carries no character Shiprocket would mangle", () => {
    expect(teamOrderNo(42)).toBe("BHX-SE-00042");
  });
});
