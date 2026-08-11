import { describe, expect, it } from "vitest";
import { addIsoDays, adjustmentTotal, endOfDay, formatPayoutNo, netOfLine, nextRunDate, payoutTotals, proposePeriod } from "./payouts";

describe("addIsoDays", () => {
  it("walks a calendar day forward and back", () => {
    expect(addIsoDays("2026-08-11", 7)).toBe("2026-08-18");
    expect(addIsoDays("2026-08-11", -1)).toBe("2026-08-10");
  });

  it("crosses a month and a year", () => {
    expect(addIsoDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addIsoDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("crosses the end of February in a leap year", () => {
    expect(addIsoDays("2028-02-28", 1)).toBe("2028-02-29");
  });
});

describe("endOfDay", () => {
  it("covers the whole of the closing day, not half of it", () => {
    // A commission that matured at four in the afternoon belongs to a run that
    // closes that day.
    const matured = new Date("2026-08-11T16:00:00");
    expect(matured <= endOfDay("2026-08-11")).toBe(true);
  });
});

describe("proposePeriod", () => {
  it("starts the day after the last run, so no day is covered twice or skipped", () => {
    expect(proposePeriod("2026-08-04", "2026-08-11")).toEqual({ from: "2026-08-05", to: "2026-08-11" });
  });

  it("reaches back to catch what is already on the books when nothing has been run", () => {
    expect(proposePeriod(null, "2026-08-11", 90)).toEqual({ from: "2026-05-13", to: "2026-08-11" });
  });

  it("never proposes a period that ends before it begins", () => {
    const period = proposePeriod("2026-08-11", "2026-08-11");
    expect(period).toEqual({ from: "2026-08-11", to: "2026-08-11" });
  });
});

describe("nextRunDate", () => {
  it("is today when today is the payout day", () => {
    expect(nextRunDate("2026-08-10", 1)).toBe("2026-08-10");   // a Monday
  });

  it("is the coming payout day otherwise", () => {
    expect(nextRunDate("2026-08-11", 1)).toBe("2026-08-17");   // Tuesday → next Monday
  });
});

describe("adjustments", () => {
  it("sums a recovery as the negative it is", () => {
    expect(adjustmentTotal([{ name: "Kit returned after last run", amount: -450 }, { name: "Bonus", amount: 200 }])).toBe(-250);
    expect(adjustmentTotal()).toBe(0);
  });

  it("nets a rep's line against them", () => {
    expect(netOfLine(1800, [{ name: "Recovery", amount: -450 }])).toBe(1350);
    expect(netOfLine(1800)).toBe(1800);
  });
});

describe("payoutTotals", () => {
  it("adds a run up from its lines rather than storing a total beside them", () => {
    expect(payoutTotals([
      { orderCount: 3, gross: 1350, net: 1350 },
      { orderCount: 1, gross: 450, net: 0 }
    ])).toEqual({ reps: 2, orders: 4, gross: 1800, net: 1350 });
  });

  it("is empty for a run that found nobody to pay", () => {
    expect(payoutTotals([])).toEqual({ reps: 0, orders: 0, gross: 0, net: 0 });
  });
});

describe("formatPayoutNo", () => {
  it("has its own series, restarting with the financial year", () => {
    expect(formatPayoutNo("2026-27", 4)).toBe("PO/2026-27/0004");
  });
});
