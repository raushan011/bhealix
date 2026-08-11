import { financialYear } from "@/lib/billing/numbering";
import { fromDateInput, toDateInput, weekdayOf, WEEKDAYS } from "@/lib/time";
import { DEFAULT_BACKFILL_DAYS } from "./constants";

/**
 * When a payout run covers, what it is called, and what it adds up to.
 *
 * Periods are `"yyyy-mm-dd"` strings for the reason §4.7 gives: a payout week is
 * a run of calendar days wherever the server happens to be, and a `Date` would
 * drag a timezone into a question that has none. Maturity, which is a real
 * instant, stays a `Date` — the two meet at `endOfDay` below.
 */

/** Days forward or back on a calendar day, anchored at midday so DST cannot move it. */
export const addIsoDays = (iso: string, days: number) =>
  toDateInput(new Date(fromDateInput(iso).getTime() + days * 86_400_000));

/**
 * The last instant of a calendar day, local time.
 *
 * A run "up to the 11th" must include a commission that matured at four o'clock
 * that afternoon. Comparing against midday — which is where `fromDateInput`
 * anchors — would quietly leave half of every closing day behind.
 */
export const endOfDay = (iso: string) => new Date(`${iso}T23:59:59.999`);

export type PayoutPeriod = { from: string; to: string };

/**
 * The period the next run should cover.
 *
 * It starts the day after the last run ended, so no day is ever covered twice
 * and — more importantly — no day is skipped. With no previous run it reaches
 * back far enough to catch the orders already on the books.
 */
export function proposePeriod(lastTo: string | null | undefined, todayIso: string, backfillDays = DEFAULT_BACKFILL_DAYS): PayoutPeriod {
  const from = lastTo ? addIsoDays(lastTo, 1) : addIsoDays(todayIso, -backfillDays);
  // A run generated twice in one day would otherwise propose a period that ends
  // before it begins.
  return { from: from > todayIso ? todayIso : from, to: todayIso };
}

/** The next day of the week payouts are made on; today, if today is that day. */
export function nextRunDate(todayIso: string, weekday: number): string {
  const ahead = (((weekday - weekdayOf(todayIso)) % 7) + 7) % 7;
  return addIsoDays(todayIso, ahead);
}

export const weekdayName = (weekday: number) => WEEKDAYS[((weekday % 7) + 7) % 7];

/** "1 Aug – 11 Aug 2026", or a single day where the period is one. */
export function periodLabel({ from, to }: PayoutPeriod): string {
  const start = fromDateInput(from), end = fromDateInput(to);
  const day = (date: Date, withYear: boolean) =>
    date.toLocaleDateString("en-IN", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) });
  if (from === to) return day(end, true);
  const sameYear = start.getFullYear() === end.getFullYear();
  return `${day(start, !sameYear)} – ${day(end, true)}`;
}

/** Badge colours for a run's state, so it reads the same on every screen. */
export function payoutTone(status?: string): "success" | "info" | "neutral" {
  return status === "Paid" ? "success" : status === "Approved" ? "info" : "neutral";
}

/** `PO/2026-27/0004` — its own series, restarting with the financial year like every other. */
export function formatPayoutNo(year: string, sequence: number): string {
  return `PO/${year}/${String(sequence).padStart(4, "0")}`;
}

export const payoutFinancialYear = financialYear;

// ------------------------------------------------------------------- totalling

export type PayoutAdjustment = { name: string; amount: number };

/**
 * What one rep is owed on a run: their commissions, plus whatever was adjusted
 * by hand.
 *
 * Adjustments are signed, so a recovery for a parcel that came back after the
 * last run is a negative line with a name on it rather than a silently smaller
 * total. Somebody has to be able to read a payout advice and see why it is not
 * what they expected.
 */
export const adjustmentTotal = (adjustments: readonly PayoutAdjustment[] = []) =>
  adjustments.reduce((total, entry) => total + (Number(entry.amount) || 0), 0);

export const netOfLine = (gross: number, adjustments: readonly PayoutAdjustment[] = []) =>
  Math.round(gross + adjustmentTotal(adjustments));

export type PayoutLineLike = { orderCount?: number; gross?: number; net?: number };
export type PayoutTotals = { reps: number; orders: number; gross: number; net: number };

/** A run's totals, always derived from its lines rather than stored beside them. */
export function payoutTotals(lines: readonly PayoutLineLike[]): PayoutTotals {
  return lines.reduce<PayoutTotals>(
    (totals, line) => ({
      reps: totals.reps + 1,
      orders: totals.orders + (line.orderCount ?? 0),
      gross: totals.gross + (line.gross ?? 0),
      net: totals.net + (line.net ?? 0)
    }),
    { reps: 0, orders: 0, gross: 0, net: 0 }
  );
}
