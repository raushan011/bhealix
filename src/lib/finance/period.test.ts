import { describe, expect, it } from "vitest";
import {
  financialYearOf, formatPeriod, isPeriod, periodDays, periodOf, periodRange, recentPeriods, shiftPeriod
} from "./period";

describe("isPeriod", () => {
  it("takes a month and refuses anything that only looks like one", () => {
    expect(isPeriod("2026-08")).toBe(true);
    expect(isPeriod("2026-13")).toBe(false);
    expect(isPeriod("2026-00")).toBe(false);
    expect(isPeriod("2026-8")).toBe(false);
    expect(isPeriod("2026-08-01")).toBe(false);
  });
});

describe("periodOf", () => {
  it("reads the month on the working clock, not the host's", () => {
    /*
     * The case this exists for. 20:30 UTC on the 31st of August is 02:00 on the
     * 1st of September in Delhi — so a month-end invoice timestamped then
     * belongs to September, and a server keeping UTC would file it into August.
     */
    expect(periodOf(new Date("2026-08-31T20:30:00Z"))).toBe("2026-09");
    // Half an hour earlier by the same clock is 23:30 on the 31st in Delhi, and
    // still August.
    expect(periodOf(new Date("2026-08-31T18:00:00Z"))).toBe("2026-08");
  });
});

describe("shiftPeriod", () => {
  it("crosses a year end in both directions", () => {
    expect(shiftPeriod("2026-01", -1)).toBe("2025-12");
    expect(shiftPeriod("2026-12", 1)).toBe("2027-01");
    expect(shiftPeriod("2026-08", -14)).toBe("2025-06");
  });

  it("leaves something that is not a month alone", () => {
    expect(shiftPeriod("not-a-month", -1)).toBe("not-a-month");
  });
});

describe("periodDays", () => {
  it("finds the last day of a month, February included", () => {
    expect(periodDays("2026-08")).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(periodDays("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    // 2028 is a leap year; the 29th is a real freight day and a real invoice.
    expect(periodDays("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(periodDays("2026-04")).toEqual({ from: "2026-04-01", to: "2026-04-30" });
  });
});

describe("periodRange", () => {
  it("covers the whole month and not one instant of its neighbours", () => {
    const august = periodRange("2026-08");
    // The month begins at midnight in Delhi, which is 18:30 the evening before.
    expect(august.$gte.toISOString()).toBe("2026-07-31T18:30:00.000Z");
    expect(august.$lte.toISOString()).toBe("2026-08-31T18:29:59.999Z");

    const september = periodRange("2026-09");
    // No gap and no overlap: an invoice cannot fall between two months, nor into
    // both, which would double-count it in the totals.
    expect(september.$gte.getTime() - august.$lte.getTime()).toBe(1);
  });
});

describe("formatPeriod", () => {
  it("says the month the way somebody says it to their accountant", () => {
    expect(formatPeriod("2026-08")).toBe("August 2026");
    expect(formatPeriod("2026-01")).toBe("January 2026");
  });
});

describe("financialYearOf", () => {
  it("runs April to March, as the return does", () => {
    expect(financialYearOf("2026-04")).toBe("2026-27");
    expect(financialYearOf("2026-12")).toBe("2026-27");
    expect(financialYearOf("2027-03")).toBe("2026-27");
    // The first of April is a new year; the thirty-first of March is not.
    expect(financialYearOf("2027-04")).toBe("2027-28");
  });

  it("carries a century boundary without producing a year 100", () => {
    expect(financialYearOf("2099-05")).toBe("2099-00");
  });
});

describe("recentPeriods", () => {
  it("offers this month and the ones behind it, newest first", () => {
    expect(recentPeriods(4, "2026-02")).toEqual(["2026-02", "2026-01", "2025-12", "2025-11"]);
  });

  it("never offers a month that has not happened", () => {
    // A bill that has not been raised cannot be filed, and a dropdown offering
    // next March is an invitation to file August's invoice out of reach.
    expect(recentPeriods(12).every(month => month <= recentPeriods(1)[0])).toBe(true);
  });
});
