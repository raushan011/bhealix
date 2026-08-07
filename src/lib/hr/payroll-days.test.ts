import { describe, expect, it } from "vitest";
import { daysFor, lossOfPay, statutoryOf } from "./payroll-run";
import { DEFAULT_STATUTORY } from "./payroll";
import type { ResolvedDay } from "./records";
import type { AttendanceStatus } from "./attendance";
import type { LeaveType } from "./leave";

const day = (
  date: string,
  status: AttendanceStatus | null,
  source: ResolvedDay["source"] = "Manual",
  leaveType?: LeaveType
): ResolvedDay => ({ date, status, source, leaveType });

/** A thirty-day month with nothing marked on it. */
const blank = (count = 30): ResolvedDay[] =>
  Array.from({ length: count }, (_, index) =>
    day(`2026-09-${String(index + 1).padStart(2, "0")}`, null, null));

describe("what costs somebody a day's pay", () => {
  it("counts an absence", () => {
    expect(lossOfPay([day("2026-09-01", "Absent")])).toBe(1);
  });

  it("counts unpaid leave and nothing else", () => {
    expect(lossOfPay([day("2026-09-01", "On leave", "Leave", "Unpaid")])).toBe(1);
    expect(lossOfPay([day("2026-09-02", "On leave", "Leave", "Casual")])).toBe(0);
    expect(lossOfPay([day("2026-09-03", "On leave", "Leave", "Sick")])).toBe(0);
    expect(lossOfPay([day("2026-09-04", "On leave", "Leave", "Earned")])).toBe(0);
  });

  it("charges half a day of unpaid leave, and nothing for half a day of paid", () => {
    expect(lossOfPay([day("2026-09-01", "Half day", "Leave", "Unpaid")])).toBe(0.5);
    // The other half was worked, so a paid half day costs nothing at all.
    expect(lossOfPay([day("2026-09-02", "Half day", "Leave", "Casual")])).toBe(0);
  });

  it("charges half a day marked by hand, which no leave covers", () => {
    expect(lossOfPay([day("2026-09-01", "Half day", "Manual")])).toBe(0.5);
  });

  /**
   * The rule the whole attendance design rests on. An unmarked day means nobody
   * has said yet — treating it as an absence would dock salary for a sheet
   * somebody has not got round to filling in.
   */
  it("never charges for a day nobody has marked", () => {
    expect(lossOfPay(blank())).toBe(0);
  });

  it("charges nothing for a present day, a week off or a holiday", () => {
    expect(lossOfPay([
      day("2026-09-01", "Present"),
      day("2026-09-02", "Present", "Auto"),
      day("2026-09-06", "Week off"),
      day("2026-09-07", "Holiday", "Holiday")
    ])).toBe(0);
  });

  it("adds a month of mixed marks up as a whole", () => {
    const days = [
      ...blank(20),
      day("2026-09-21", "Absent"),
      day("2026-09-22", "Absent"),
      day("2026-09-23", "On leave", "Leave", "Unpaid"),
      day("2026-09-24", "On leave", "Leave", "Casual"),
      day("2026-09-25", "Half day", "Manual"),
      day("2026-09-26", "Half day", "Leave", "Unpaid"),
      day("2026-09-27", "Present")
    ];
    expect(lossOfPay(days)).toBe(4);
  });
});

describe("the days a month is divided by", () => {
  const month = [
    ...Array.from({ length: 28 }, (_, index) => day(`2026-09-${String(index + 1).padStart(2, "0")}`, null, null)),
    day("2026-09-29", "Week off"),
    day("2026-09-30", "Holiday", "Holiday")
  ];

  it("counts every calendar day on the calendar basis, week offs and holidays included", () => {
    const counted = daysFor(month, "Calendar days");
    expect(counted.divisorDays).toBe(30);
    expect(counted.onRollDays).toBe(30);
  });

  it("leaves week offs and holidays out on the working-days basis", () => {
    const counted = daysFor(month, "Working days");
    expect(counted.divisorDays).toBe(28);
    expect(counted.onRollDays).toBe(28);
  });

  it("shortens the days on the rolls for somebody who joined mid-month", () => {
    const counted = daysFor(month, "Calendar days", "2026-09-16");
    // The divisor stays the whole month — that is what pro-rating means.
    expect(counted.divisorDays).toBe(30);
    expect(counted.onRollDays).toBe(15);
  });

  it("stops at the last working day for somebody who left", () => {
    const counted = daysFor(month, "Calendar days", undefined, "2026-09-10");
    expect(counted.divisorDays).toBe(30);
    expect(counted.onRollDays).toBe(10);
  });

  it("handles somebody who joined and left inside the same month", () => {
    const counted = daysFor(month, "Calendar days", "2026-09-05", "2026-09-14");
    expect(counted.onRollDays).toBe(10);
  });

  it("ignores an absence on a day before they had joined", () => {
    // A mark left over from an earlier stint must not dock the new one.
    const withEarlyAbsence = month.map(entry =>
      entry.date === "2026-09-03" ? day(entry.date, "Absent") : entry);
    expect(daysFor(withEarlyAbsence, "Calendar days", "2026-09-16").lopDays).toBe(0);
    expect(daysFor(withEarlyAbsence, "Calendar days").lopDays).toBe(1);
  });

  it("gives nobody any days when they were not on the rolls at all", () => {
    const counted = daysFor(month, "Calendar days", "2026-10-01");
    expect(counted.onRollDays).toBe(0);
  });
});

describe("whether the provident fund applies", () => {
  it("keeps everybody out of it while the company runs no fund", () => {
    expect(statutoryOf({ ...DEFAULT_STATUTORY, pfApplicable: true }, false).pfApplicable).toBe(false);
  });

  it("assumes no fund when nobody has said", () => {
    // The default matters: a settings document written before there was a
    // switch must not be read as a company that deducts.
    expect(statutoryOf({ ...DEFAULT_STATUTORY, pfApplicable: true }).pfApplicable).toBe(false);
  });

  it("puts somebody in it once the company runs one", () => {
    expect(statutoryOf({ ...DEFAULT_STATUTORY, pfApplicable: true }, true).pfApplicable).toBe(true);
  });

  it("still leaves out somebody their own record excludes", () => {
    expect(statutoryOf({ ...DEFAULT_STATUTORY, pfApplicable: false }, true).pfApplicable).toBe(false);
  });

  it("changes nothing else about the profile", () => {
    const profile = statutoryOf({ ...DEFAULT_STATUTORY, monthlyTds: 1_200 }, false);
    expect(profile.esiApplicable).toBe(true);
    expect(profile.professionalTaxApplicable).toBe(true);
    expect(profile.monthlyTds).toBe(1_200);
  });
});
