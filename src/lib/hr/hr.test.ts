import { describe, expect, it } from "vitest";
import { canCancel, canDecide, leaveBalances, leaveDays, leaveYear, overlaps, type LeaveLedgerRow } from "./leave";
import {
  inferredStatus, isWorkingDay, monthDays, parseMonth, summariseAttendance, type AttendanceDay
} from "./attendance";

describe("leaveDays", () => {
  it("counts a single day as one", () => {
    expect(leaveDays("2026-08-05", "2026-08-05")).toBe(1);
  });

  it("counts both ends of a range", () => {
    expect(leaveDays("2026-08-05", "2026-08-07")).toBe(3);
  });

  it("counts across a month end", () => {
    expect(leaveDays("2026-01-30", "2026-02-02")).toBe(4);
  });

  it("halves a single day when half a day is asked for", () => {
    expect(leaveDays("2026-08-05", "2026-08-05", "First half")).toBe(0.5);
  });

  it("ignores half a day on a range, which cannot mean anything", () => {
    expect(leaveDays("2026-08-05", "2026-08-07", "First half")).toBe(3);
  });

  it("refuses a range that ends before it starts", () => {
    expect(leaveDays("2026-08-07", "2026-08-05")).toBe(0);
  });

  it("returns nothing for an unparseable date rather than NaN", () => {
    expect(leaveDays("", "2026-08-05")).toBe(0);
    expect(leaveDays("not-a-date", "also-not")).toBe(0);
  });
});

describe("overlaps", () => {
  it("catches a request landing inside one already made", () => {
    expect(overlaps({ from: "2026-08-05", to: "2026-08-09" }, { from: "2026-08-06", to: "2026-08-07" })).toBe(true);
  });

  it("catches a partial overlap from either side", () => {
    expect(overlaps({ from: "2026-08-05", to: "2026-08-09" }, { from: "2026-08-08", to: "2026-08-12" })).toBe(true);
    expect(overlaps({ from: "2026-08-05", to: "2026-08-09" }, { from: "2026-08-01", to: "2026-08-05" })).toBe(true);
  });

  it("lets neighbouring ranges through", () => {
    expect(overlaps({ from: "2026-08-05", to: "2026-08-09" }, { from: "2026-08-10", to: "2026-08-12" })).toBe(false);
  });
});

describe("leaveBalances", () => {
  const rows: LeaveLedgerRow[] = [
    { type: "Casual", status: "Approved", days: 3 },
    { type: "Casual", status: "Pending", days: 2 },
    { type: "Casual", status: "Rejected", days: 5 },
    { type: "Sick", status: "Approved", days: 1 }
  ];

  it("spends approved leave and holds pending leave back", () => {
    const casual = leaveBalances(rows).find(row => row.type === "Casual")!;
    expect(casual).toMatchObject({ entitled: 12, taken: 3, pending: 2, available: 7 });
  });

  it("ignores refused requests entirely", () => {
    // 12 − 3 approved − 2 pending = 7; the 5 rejected days count for nothing.
    expect(leaveBalances(rows).find(row => row.type === "Casual")!.available).toBe(7);
  });

  it("honours an entitlement set for one employee", () => {
    const casual = leaveBalances(rows, { Casual: 20 }).find(row => row.type === "Casual")!;
    expect(casual.entitled).toBe(20);
    expect(casual.available).toBe(15);
  });

  it("never goes below zero", () => {
    const over = leaveBalances([{ type: "Sick", status: "Approved", days: 99 }]).find(row => row.type === "Sick")!;
    expect(over.available).toBe(0);
  });

  it("leaves unpaid leave uncapped", () => {
    const unpaid = leaveBalances([{ type: "Unpaid", status: "Approved", days: 40 }]).find(row => row.type === "Unpaid")!;
    expect(unpaid.taken).toBe(40);
    expect(unpaid.available).toBe(Infinity);
  });

  it("reports every type, including ones never taken", () => {
    expect(leaveBalances([])).toHaveLength(5);
  });
});

describe("leaveYear", () => {
  it("runs April to March, like the books", () => {
    expect(leaveYear(new Date(2026, 3, 1))).toBe("2026-27");
    expect(leaveYear(new Date(2026, 2, 31))).toBe("2025-26");
  });
});

describe("leave transitions", () => {
  it("allows a decision or a withdrawal only while pending", () => {
    expect(canDecide("Pending")).toBe(true);
    expect(canDecide("Approved")).toBe(false);
    expect(canCancel("Pending")).toBe(true);
    expect(canCancel("Rejected")).toBe(false);
  });
});

describe("summariseAttendance", () => {
  const month: AttendanceDay[] = [
    { date: "2026-08-01", status: "Present" },
    { date: "2026-08-02", status: "Week off" },
    { date: "2026-08-03", status: "Present" },
    { date: "2026-08-04", status: "Half day" },
    { date: "2026-08-05", status: "Absent" },
    { date: "2026-08-06", status: "On leave" },
    { date: "2026-08-07", status: "Holiday" }
  ];

  it("counts each kind of day", () => {
    expect(summariseAttendance(month)).toMatchObject({
      present: 2, absent: 1, halfDay: 1, leave: 1, offDays: 2
    });
  });

  it("expects work on every day that is not an off day", () => {
    // Five working days: two present, one half, one absent, one on leave.
    expect(summariseAttendance(month).expected).toBe(5);
  });

  it("counts a half day as half a day worked", () => {
    expect(summariseAttendance(month).worked).toBe(2.5);
    expect(summariseAttendance(month).percent).toBe(50);
  });

  it("is zero rather than NaN for a month of nothing but off days", () => {
    expect(summariseAttendance([{ date: "2026-08-02", status: "Week off" }])).toMatchObject({ expected: 0, percent: 0 });
  });

  it("has nothing to report for an empty month", () => {
    expect(summariseAttendance([])).toMatchObject({ present: 0, expected: 0, worked: 0, percent: 0 });
  });
});

describe("isWorkingDay", () => {
  it("excludes week offs and holidays, and nothing else", () => {
    expect(isWorkingDay("Present")).toBe(true);
    expect(isWorkingDay("Absent")).toBe(true);
    expect(isWorkingDay("On leave")).toBe(true);
    expect(isWorkingDay("Week off")).toBe(false);
    expect(isWorkingDay("Holiday")).toBe(false);
  });
});

describe("inferredStatus", () => {
  it("marks a rep present on the strength of a completed visit", () => {
    expect(inferredStatus(1)).toBe("Present");
  });

  it("infers nothing from a day with no completed visit", () => {
    // Silence, not an absence: they may have been in the office or on leave.
    expect(inferredStatus(0)).toBeNull();
  });
});

describe("monthDays", () => {
  it("returns every day of the month in order", () => {
    const days = monthDays(2026, 2);
    expect(days).toHaveLength(28);
    expect(days[0]).toBe("2026-02-01");
    expect(days.at(-1)).toBe("2026-02-28");
  });

  it("knows a leap year", () => {
    expect(monthDays(2028, 2)).toHaveLength(29);
  });

  it("handles the thirty-one day months", () => {
    expect(monthDays(2026, 12)).toHaveLength(31);
  });
});

describe("parseMonth", () => {
  it("reads a month input", () => {
    expect(parseMonth("2026-08")).toEqual({ year: 2026, month: 8 });
  });

  it("rejects nonsense rather than guessing", () => {
    expect(parseMonth("2026-13")).toBeNull();
    expect(parseMonth("2026-00")).toBeNull();
    expect(parseMonth("August")).toBeNull();
  });
});
