/**
 * Attendance vocabulary and arithmetic. Free of Mongoose and React so the
 * marking screen, the monthly summary and the server agree on what a day counts
 * for.
 */

export const ATTENDANCE_STATUSES = ["Present", "Absent", "Half day", "On leave", "Week off", "Holiday"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

/** How the day got its mark: worked out from the field, or set by hand. */
export const ATTENDANCE_SOURCES = ["Auto", "Manual", "Leave"] as const;
export type AttendanceSource = (typeof ATTENDANCE_SOURCES)[number];

/**
 * What a day is worth when the month is added up. A week off and a holiday are
 * not worked days and are not absences either, so they count for nothing and are
 * excluded from the days-expected figure.
 */
const DAY_VALUE: Record<AttendanceStatus, number> = {
  "Present": 1,
  "Half day": 0.5,
  "On leave": 0,
  "Absent": 0,
  "Week off": 0,
  "Holiday": 0
};

/** Whether the day was one the employee was expected to work. */
export const isWorkingDay = (status: AttendanceStatus) =>
  status !== "Week off" && status !== "Holiday";

export const ATTENDANCE_TONE: Record<AttendanceStatus, "success" | "danger" | "warn" | "info" | "neutral"> = {
  "Present": "success",
  "Absent": "danger",
  "Half day": "warn",
  "On leave": "info",
  "Week off": "neutral",
  "Holiday": "neutral"
};

/** A single letter for the month grid, where a full word will not fit. */
export const ATTENDANCE_INITIAL: Record<AttendanceStatus, string> = {
  "Present": "P",
  "Absent": "A",
  "Half day": "H",
  "On leave": "L",
  "Week off": "W",
  "Holiday": "O"
};

export type AttendanceDay = { date: string; status: AttendanceStatus };

export type AttendanceSummary = {
  present: number;
  absent: number;
  halfDay: number;
  leave: number;
  offDays: number;
  /** Days the employee was expected to work. */
  expected: number;
  /** Days actually worked, counting a half day as a half. */
  worked: number;
  /** Worked as a percentage of expected, rounded. */
  percent: number;
};

/** Folds a month of marks into the figures a payroll or a review needs. */
export function summariseAttendance(days: AttendanceDay[]): AttendanceSummary {
  const summary: AttendanceSummary = {
    present: 0, absent: 0, halfDay: 0, leave: 0, offDays: 0,
    expected: 0, worked: 0, percent: 0
  };

  for (const day of days) {
    if (day.status === "Present") summary.present++;
    else if (day.status === "Absent") summary.absent++;
    else if (day.status === "Half day") summary.halfDay++;
    else if (day.status === "On leave") summary.leave++;
    else summary.offDays++;

    if (isWorkingDay(day.status)) summary.expected++;
    summary.worked += DAY_VALUE[day.status];
  }

  summary.percent = summary.expected > 0 ? Math.round((summary.worked / summary.expected) * 100) : 0;
  return summary;
}

/**
 * The day a rep's own work implies.
 *
 * A completed visit is proof they were out working, so the month fills itself in
 * from the field rather than from somebody ticking boxes. Only days with no mark
 * of their own are inferred — anything set by hand, or covered by approved
 * leave, stands.
 */
export function inferredStatus(completedVisits: number): AttendanceStatus | null {
  return completedVisits > 0 ? "Present" : null;
}

/** Every date in a month as "yyyy-mm-dd", in order. */
export function monthDays(year: number, month: number): string[] {
  const total = new Date(year, month, 0).getDate();
  return Array.from({ length: total }, (_, index) =>
    `${year}-${String(month).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`);
}

/** "2026-08" for a month input, and back again. */
export const monthKey = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;

export function parseMonth(value: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}
