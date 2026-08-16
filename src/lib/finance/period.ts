import { dayOf, endOfDay, startOfDay } from "@/lib/time";

/**
 * The accounting month, as the vault files things by.
 *
 * `"2026-08"`, and nothing cleverer. A financial year runs April to March here
 * and the temptation is to make the period the unit of that — but the accountant
 * asks for August, the vendors bill by calendar month, and a quarter is four
 * months of files rather than a different kind of thing. The year view is built
 * by listing months, which keeps one format everywhere.
 *
 * Every boundary is taken on the working clock (`lib/time`), not on the host's.
 * A machine keeping UTC believes the first of the month starts at half past five
 * on the evening of the thirty-first, which would file the month-end invoices —
 * exactly the ones that arrive at the last minute — into the month before.
 */

export const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

export const isPeriod = (value: unknown): value is string =>
  typeof value === "string" && PERIOD.test(value);

/** The month a moment fell in, on the working clock. */
export const periodOf = (value: string | Date): string => dayOf(value).slice(0, 7);

/** This month, as the desk is having it. */
export const currentPeriod = (): string => periodOf(new Date());

/** "2026-08" moved by whole months. Plain calendar arithmetic, no zone in it. */
export function shiftPeriod(period: string, months: number): string {
  if (!isPeriod(period)) return period;
  const [year, month] = period.split("-").map(Number);
  // Date.UTC normalises an out-of-range month, so month 0 becomes December of
  // the year before and month 13 becomes January of the next, without a branch.
  const moved = new Date(Date.UTC(year, month - 1 + months, 1));
  return moved.toISOString().slice(0, 7);
}

/** The first and last day of a month, as "yyyy-mm-dd" — the form the vendor APIs take. */
export function periodDays(period: string): { from: string; to: string } {
  const [year, month] = period.split("-").map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${period}-01`, to: `${period}-${String(last).padStart(2, "0")}` };
}

/** The month as the pair of real moments a query can hold a stored date against. */
export function periodRange(period: string): { $gte: Date; $lte: Date } {
  const { from, to } = periodDays(period);
  return { $gte: startOfDay(from), $lte: endOfDay(to) };
}

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"] as const;

/** "August 2026" — the month as somebody would say it to their accountant. */
export function formatPeriod(period: string): string {
  if (!isPeriod(period)) return period;
  const [year, month] = period.split("-").map(Number);
  return `${MONTHS[month - 1]} ${year}`;
}

/** "Aug 2026", for a chip or a file name. */
export function shortPeriod(period: string): string {
  if (!isPeriod(period)) return period;
  const [year, month] = period.split("-").map(Number);
  return `${MONTHS[month - 1].slice(0, 3)} ${year}`;
}

/**
 * The months to offer in a picker: this one and the ones behind it, newest
 * first.
 *
 * No future months. A bill that has not been raised cannot be filed, and a
 * dropdown offering next March is an invitation to file August's Meta invoice
 * somewhere nobody will look for it again.
 */
export function recentPeriods(count = 24, from = currentPeriod()): string[] {
  return Array.from({ length: count }, (_, index) => shiftPeriod(from, -index));
}

/**
 * The financial year a month belongs to, Indian convention: April to March,
 * written "2026-27".
 *
 * Shown rather than filed against — the vault stores months — because the one
 * question a period list cannot answer at a glance is which return a month ends
 * up in, and that is the question being asked when somebody scrolls back to
 * March.
 */
export function financialYearOf(period: string): string {
  if (!isPeriod(period)) return "";
  const [year, month] = period.split("-").map(Number);
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}
