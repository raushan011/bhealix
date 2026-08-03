import { z } from "zod";
import { toDisplayTime, toMinutes, WEEKDAY_SHORT } from "@/lib/time";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const slotSchema = z.object({
  start: z.string().regex(HHMM, "Use a time like 14:00"),
  end: z.string().regex(HHMM, "Use a time like 16:00")
}).refine(slot => (toMinutes(slot.end) ?? 0) > (toMinutes(slot.start) ?? 0), {
  message: "End time must be after start time"
});

export const callWindowSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  slots: z.array(slotSchema).min(1, "Add at least one time slot").max(3),
  appointmentRequired: z.boolean().default(false),
  remarks: z.string().max(300).default("")
});

export const callScheduleSchema = z.array(callWindowSchema).max(7)
  .refine(schedule => new Set(schedule.map(w => w.weekday)).size === schedule.length, {
    message: "Each day can only appear once"
  });

export type CallWindow = z.infer<typeof callWindowSchema>;

/** "Mon, Wed · 2:00 PM–4:00 PM" — the one-line form used on cards and lists. */
export function summariseCallSchedule(schedule: CallWindow[] = []): string {
  if (!schedule.length) return "Call time not recorded";
  const days = [...schedule].sort((a, b) => a.weekday - b.weekday);
  const times = new Set(days.flatMap(w => w.slots.map(s => `${toDisplayTime(s.start)}–${toDisplayTime(s.end)}`)));
  const dayLabel = days.map(w => WEEKDAY_SHORT[w.weekday]).join(", ");
  return times.size === 1 ? `${dayLabel} · ${[...times][0]}` : `${dayLabel} · ${times.size} time slots`;
}

export function slotsForWeekday(schedule: CallWindow[] = [], weekday: number) {
  return schedule.find(window => window.weekday === weekday)?.slots ?? [];
}
