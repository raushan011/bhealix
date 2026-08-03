export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** "14:30" -> 870 minutes past midnight. Returns null for anything unparseable. */
export function toMinutes(time: string): number | null {
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
export function toDisplayTime(time: string): string {
  const minutes = toMinutes(time);
  if (minutes === null) return time;
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

export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function formatDate(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}
