import { describe, expect, it } from "vitest";
import {
  clockOf, dayOf, dayRange, endOfDay, formatDate, formatDateTime, fromDateInput, shiftDay,
  startOfDay, toDateInput, toMinutes, toClock, toDisplayTime, weekdayOf
} from "./time";

/**
 * These read the working clock, so they hold whatever zone the machine running
 * them keeps — a laptop in Delhi and a build server in UTC must agree.
 */
describe("the working clock", () => {
  it("reads a stored moment on Indian time, not the host's", () => {
    // What a call registered at 12:17 in Delhi is stored as.
    expect(clockOf(new Date("2026-08-14T06:47:00Z"))).toBe("12:17");
    expect(dayOf(new Date("2026-08-14T06:47:00Z"))).toBe("2026-08-14");
  });

  it("keeps the small hours on the day the field lived them", () => {
    // 01:00 in Delhi is still the previous evening in UTC. Reading it as UTC
    // moved a night's work onto the day before.
    expect(dayOf(new Date("2026-08-13T19:30:00Z"))).toBe("2026-08-14");
    expect(clockOf(new Date("2026-08-13T19:30:00Z"))).toBe("01:00");
  });

  it("starts a day at midnight in Delhi and ends it just before the next", () => {
    expect(startOfDay("2026-08-14").toISOString()).toBe("2026-08-13T18:30:00.000Z");
    expect(endOfDay("2026-08-14").toISOString()).toBe("2026-08-14T18:29:59.999Z");
  });

  it("holds a stored date inside the range of the day it belongs to", () => {
    const range = dayRange("2026-08-14", "2026-08-14")!;
    const registered = new Date("2026-08-14T06:47:00Z");
    expect(registered >= range.$gte!).toBe(true);
    expect(registered <= range.$lte!).toBe(true);
    // The evening before, in Delhi, is not part of it.
    expect(new Date("2026-08-13T18:00:00Z") >= range.$gte!).toBe(false);
  });

  it("leaves an end open, and drops anything that is not a date", () => {
    expect(dayRange("2026-08-14", null)!.$lte).toBeUndefined();
    expect(dayRange(null, "2026-08-14")!.$gte).toBeUndefined();
    // These arrive from the address bar; an unparseable one must not reach the
    // database, where it would land as `Invalid Date`.
    expect(dayRange("last tuesday", "")).toBeNull();
    expect(dayRange(undefined, undefined)).toBeNull();
  });

  it("moves whole days across the end of a month", () => {
    expect(shiftDay("2026-08-31", 1)).toBe("2026-09-01");
    expect(shiftDay("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftDay("2026-08-16", -6)).toBe("2026-08-10");
  });

  it("round-trips a chosen day through storage and back", () => {
    expect(toDateInput(fromDateInput("2026-08-14"))).toBe("2026-08-14");
    expect(formatDate(fromDateInput("2026-08-14"))).toMatch(/14 Aug/);
  });
});

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
