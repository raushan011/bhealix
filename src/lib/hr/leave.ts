/**
 * Leave vocabulary and arithmetic, kept free of Mongoose and React so the
 * request form, the approval screen and the server all count a day the same way.
 */

export const LEAVE_TYPES = ["Casual", "Sick", "Earned", "Unpaid", "Compensatory"] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];

export const LEAVE_STATUSES = ["Pending", "Approved", "Rejected", "Cancelled"] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

/** Half a day, and which half — a rep who works the morning and leaves at lunch. */
export const HALF_DAY_OPTIONS = ["First half", "Second half"] as const;
export type HalfDay = (typeof HALF_DAY_OPTIONS)[number];

/**
 * The days an employee starts the year with.
 *
 * Unpaid leave is deliberately absent: it is unlimited by definition, and
 * counting a balance for it would only invite somebody to "run out".
 */
export const DEFAULT_ENTITLEMENT: Record<Exclude<LeaveType, "Unpaid">, number> = {
  Casual: 12,
  Sick: 6,
  Earned: 15,
  Compensatory: 0
};

export const isCounted = (type: LeaveType): type is Exclude<LeaveType, "Unpaid"> => type !== "Unpaid";

/**
 * How many days a request costs.
 *
 * Counts every calendar day in the range, weekends included. A shorter count
 * would need a company calendar of working days and holidays that does not
 * exist yet, and quietly under-counting leave is worse than counting plainly.
 * A half day is only meaningful on a single-day request.
 */
export function leaveDays(from: string, to: string, halfDay?: HalfDay | null): number {
  const start = Date.parse(`${from}T00:00:00`);
  const end = Date.parse(`${to}T00:00:00`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;

  const days = Math.round((end - start) / 86_400_000) + 1;
  return days === 1 && halfDay ? 0.5 : days;
}

/** Ranges overlap when neither finishes before the other starts. */
export function overlaps(a: { from: string; to: string }, b: { from: string; to: string }): boolean {
  return a.from <= b.to && b.from <= a.to;
}

export type LeaveLedgerRow = { type: LeaveType; status: LeaveStatus; days: number };

export type LeaveBalance = {
  type: LeaveType;
  entitled: number;
  taken: number;
  pending: number;
  available: number;
};

/**
 * What is left, per type.
 *
 * Approved leave is spent; pending leave is not spent but is shown, because an
 * employee with two days left and two days awaiting approval should not be told
 * they have two days free. `available` therefore holds pending back as well.
 */
export function leaveBalances(
  rows: LeaveLedgerRow[],
  entitlement: Partial<Record<LeaveType, number>> = {}
): LeaveBalance[] {
  return LEAVE_TYPES.map(type => {
    const mine = rows.filter(row => row.type === type);
    const taken = mine.filter(row => row.status === "Approved").reduce((sum, row) => sum + row.days, 0);
    const pending = mine.filter(row => row.status === "Pending").reduce((sum, row) => sum + row.days, 0);
    const entitled = isCounted(type)
      ? entitlement[type] ?? DEFAULT_ENTITLEMENT[type]
      : 0;

    return {
      type,
      entitled,
      taken,
      pending,
      // Unpaid leave has no ceiling, so there is nothing to run down.
      available: isCounted(type) ? Math.max(0, entitled - taken - pending) : Infinity
    };
  });
}

/** The leave year runs with the financial year, as the rest of the books do. */
export function leaveYear(date: Date | string = new Date()): string {
  const value = typeof date === "string" ? new Date(date) : date;
  const startYear = value.getMonth() >= 3 ? value.getFullYear() : value.getFullYear() - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/** A status colour means the same thing at the HR desk and on the rep's phone. */
export const leaveTone = (status: LeaveStatus) =>
  status === "Approved" ? "success" as const
    : status === "Rejected" ? "danger" as const
    : status === "Cancelled" ? "neutral" as const
    : "warn" as const;

/** Only the person who asked may withdraw a request, and only before it is decided. */
export const canCancel = (status: LeaveStatus) => status === "Pending";
/** A decision is final; correcting one means asking again. */
export const canDecide = (status: LeaveStatus) => status === "Pending";
