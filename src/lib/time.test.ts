import { describe, expect, it } from "vitest";
import { formatDateTime, toDateInput, toMinutes, toClock, toDisplayTime, weekdayOf } from "./time";

describe("toDateInput", () => {
  it("keeps the local calendar day for a plan saved at local midnight", () => {
    // How the API stores a plan date: local midnight, not UTC midnight.
    const stored = new Date(2026, 7, 5);
    expect(toDateInput(stored)).toBe("2026-08-05");
    // toISOString would report 2026-08-04 anywhere east of UTC.
    expect(weekdayOf(toDateInput(stored))).toBe(3); // Wednesday
  });

  it("round-trips a date string through the input format", () => {
    expect(toDateInput(new Date(2026, 0, 1))).toBe("2026-01-01");
    expect(toDateInput(new Date(2026, 11, 31))).toBe("2026-12-31");
  });
});

describe("time helpers", () => {
  it("survives values that were never recorded", () => {
    expect(toMinutes(undefined)).toBeNull();
    expect(toDisplayTime(undefined)).toBe("—");
  });

  it("wraps past midnight rather than showing a 26th hour", () => {
    expect(toClock(25 * 60 + 15)).toBe("01:15");
  });
});

describe("formatDateTime", () => {
  it("reads a courier's own timestamp, which is not an ISO one", () => {
    // Shiprocket writes `2026-08-11 14:20:00`, with a space and no zone. Some
    // engines refuse it outright, and a scan feed showing "Invalid Date" is
    // worse than no feed at all.
    expect(formatDateTime("2026-08-11 14:20:00")).toMatch(/11 Aug/);
    expect(formatDateTime("2026-08-11 14:20:00")).toMatch(/2:20/);
  });

  it("hands back anything it cannot read, rather than inventing a date", () => {
    expect(formatDateTime("shortly")).toBe("shortly");
  });
});
