export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/**
 * The clock the company works to.
 *
 * The machine serving these pages keeps its own time, and the one we deploy to
 * keeps UTC. Left to it, a call registered at 12:17 in Delhi was written down
 * as 06:47, and anything recorded after half past five in the evening carried
 * the wrong day. Every date and clock below is therefore read on one named
 * zone rather than on whatever the host happens to believe.
 */
export const ZONE = "Asia/Kolkata";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const zoneClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hour12: false
});

/** What the working clock reads at a given instant. */
function zonedParts(at: Date) {
  const parts = zoneClock.formatToParts(at);
  const value = (type: string) => Number(parts.find(part => part.type === type)?.value);
  // Some engines report midnight as hour 24; it is hour 0 everywhere here.
  return {
    year: value("year"), month: value("month"), day: value("day"),
    hour: value("hour") % 24, minute: value("minute")
  };
}

/** "+05:30" — how far the working clock stood from UTC at that instant. */
function zoneOffset(at: Date): string {
  const { year, month, day, hour, minute } = zonedParts(at);
  const minutes = Math.round((Date.UTC(year, month - 1, day, hour, minute) - at.getTime()) / 60_000);
  const size = Math.abs(minutes);
  return `${minutes < 0 ? "-" : "+"}${String(Math.floor(size / 60)).padStart(2, "0")}:${String(size % 60).padStart(2, "0")}`;
}

/**
 * A stored value as a moment.
 *
 * A timestamp naming no zone is read on the working clock rather than on the
 * host's: couriers report `2026-08-11 14:20:00` meaning twenty past two in
 * India, and a server in UTC would otherwise move it on by five and a half
 * hours. The space-for-T is not a nicety either — only some engines parse it.
 */
function readMoment(value: string | Date): Date {
  if (typeof value !== "string") return value;
  const text = value.trim().replace(" ", "T");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) return new Date(text);
  if (/(z|[+-]\d{2}:?\d{2})$/i.test(text)) return new Date(text);
  const guess = new Date(`${text}Z`);
  return Number.isNaN(guess.getTime()) ? guess : new Date(`${text}${zoneOffset(guess)}`);
}

/** The clock a moment was read on: an instant stored as 06:47 UTC is "12:17". */
export function clockOf(value: string | Date): string {
  const at = readMoment(value);
  if (Number.isNaN(at.getTime())) return "—";
  const { hour, minute } = zonedParts(at);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** The calendar day a moment fell on, as "yyyy-mm-dd" on the working clock. */
export function dayOf(value: string | Date): string {
  const at = readMoment(value);
  if (Number.isNaN(at.getTime())) return "";
  const { year, month, day } = zonedParts(at);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** "2026-08-14" moved by whole days. Plain calendar arithmetic, no zone in it. */
export function shiftDay(isoDay: string, days: number): string {
  if (!ISO_DAY.test(isoDay)) return isoDay;
  const [year, month, day] = isoDay.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * The first instant of a working day.
 *
 * A day named on a filter has to become a pair of real moments before a query
 * can compare it with a stored one, and the 14th in Delhi begins at half past
 * six the evening before in UTC.
 */
export function startOfDay(isoDay: string): Date {
  const guess = new Date(`${isoDay}T00:00:00Z`);
  if (Number.isNaN(guess.getTime())) return guess;
  // How far the guess already sits into that day locally, wound back off it.
  const { year, month, day, hour, minute } = zonedParts(guess);
  const ahead = Date.UTC(year, month - 1, day, hour, minute) - guess.getTime();
  return new Date(guess.getTime() - ahead);
}

/** The last instant of a working day — the moment before the next one starts. */
export function endOfDay(isoDay: string): Date {
  return new Date(startOfDay(shiftDay(isoDay, 1)).getTime() - 1);
}

/**
 * A pair of chosen days as the range a query can hold a stored date against.
 *
 * Either end may be left out — "everything since Monday" is as ordinary a
 * question as a closed range. Anything that is not a date is dropped rather
 * than passed on, because these arrive from the address bar and an unparseable
 * one reaches the database as `Invalid Date`.
 */
export function dayRange(from?: string | null, to?: string | null): { $gte?: Date; $lte?: Date } | null {
  const range: { $gte?: Date; $lte?: Date } = {};
  if (from && ISO_DAY.test(from)) range.$gte = startOfDay(from);
  if (to && ISO_DAY.test(to)) range.$lte = endOfDay(to);
  return range.$gte || range.$lte ? range : null;
}

/**
 * Today, as the day the field is having it.
 *
 * "Today" asked of a machine keeping UTC begins at half past five in the
 * morning here and ends at half past five the next — which drops a rep's early
 * calls off their own dashboard and hands them last night's.
 */
export function todayRange(): { $gte: Date; $lte: Date } {
  const day = todayIso();
  return { $gte: startOfDay(day), $lte: endOfDay(day) };
}

/**
 * "14:30" -> 870 minutes past midnight. Returns null for anything unparseable,
 * including missing values — records written before a field existed still flow
 * through these helpers, so they must not throw on undefined.
 */
export function toMinutes(time: string | null | undefined): number | null {
  if (typeof time !== "string") return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;
  const hours = Number(match[1]), minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** 870 -> "14:30". Wraps past midnight so long routes never render "26:15". */
export function toClock(minutes: number): string {
  const total = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** "14:30" -> "2:30 PM" for display; field staff read 12-hour time. */
export function toDisplayTime(time: string | null | undefined): string {
  const minutes = toMinutes(time);
  if (minutes === null) return time ?? "—";
  const hours = Math.floor(minutes / 60), mins = minutes % 60;
  const suffix = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(mins).padStart(2, "0")} ${suffix}`;
}

export function formatDuration(minutes: number): string {
  const total = Math.round(minutes);
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60), mins = total % 60;
  return mins ? `${hours} hr ${mins} min` : `${hours} hr`;
}

/** Weekday of a yyyy-mm-dd string, read as a local date (not UTC). */
export function weekdayOf(isoDate: string): number {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day).getDay();
}

/**
 * A stored date as "yyyy-mm-dd" for a date field.
 *
 * Read on the working clock, not the host's: `toISOString()` reports the
 * previous day for anything saved before half past five in the morning, so
 * reopening a plan would silently walk its date backwards.
 */
export function toDateInput(value: string | Date): string {
  return dayOf(value);
}

/**
 * A "yyyy-mm-dd" form value as a Date.
 *
 * Anchored at midday on the working clock rather than midnight: a date stored
 * at midnight is one timezone conversion away from becoming the previous day,
 * and an invoice that changes its date in transit is not one anybody wants to
 * explain.
 */
export function fromDateInput(value: string): Date {
  return new Date(startOfDay(value).getTime() + 12 * 60 * 60_000);
}

export function todayIso(): string {
  return dayOf(new Date());
}

export function formatDate(value: string | Date): string {
  const date = readMoment(value);
  if (Number.isNaN(date.getTime())) return typeof value === "string" ? value : "";
  return date.toLocaleDateString("en-IN", {
    weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: ZONE
  });
}

/**
 * A moment rather than a day — for a feed of events, where two entries on the
 * same afternoon have to be told apart.
 *
 * The year is left off because these are read as "recently", and an
 * unparseable value is handed back untouched rather than shown as
 * `Invalid Date`.
 */
export function formatDateTime(value: string | Date): string {
  const date = readMoment(value);
  if (Number.isNaN(date.getTime())) return typeof value === "string" ? value : "";
  return date.toLocaleString("en-IN", {
    day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: ZONE
  });
}
