import { Card } from "@/components/ui/kit";

export type DayChoice = { label: string; date: string };

const chip = (active: boolean) =>
  `inline-flex min-h-[38px] shrink-0 items-center rounded-full border px-4 text-xs font-semibold ${
    active
      ? "border-[var(--brand)] bg-[var(--brand)] text-[var(--on-brand)]"
      : "border-[var(--line-2)] bg-[var(--surface)] text-[var(--ink-2)]"
  }`;

/**
 * Which single day the field view is showing.
 *
 * One day, not a range, and that is the whole design of the screen it belongs
 * to: a round is a day's work, and two days of rounds stacked together answers
 * neither "is this happening now" nor "what happened on Tuesday". The log next
 * door takes a range for the questions that need one.
 *
 * A form and plain links rather than `<Link>` and `router.push`, for the same
 * reason as the date filter beside it: client-side navigation changes the
 * address without repainting the panel, so the chip would move while the day
 * beneath it stayed as it was — which on this screen reads as "nobody worked".
 * It also means the row works with no JavaScript and `Show` is an ordinary
 * submit.
 */
export function VisitDayPicker({ presets, date }: {
  presets: DayChoice[];
  /** The day the page was rendered for — already checked, never raw input. */
  date: string;
}) {
  return <Card className="space-y-3 p-4">
    <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
      {presets.map(preset => (
        <a key={preset.label} href={`/admin/visits/day?date=${preset.date}`}
          className={chip(date === preset.date)}>{preset.label}</a>
      ))}
    </div>

    <form action="/admin/visits/day" method="get" className="flex flex-wrap items-center gap-2">
      <label className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none">
        <span className="shrink-0 text-xs font-medium text-[var(--muted)]">Day</span>
        <input type="date" name="date" defaultValue={date} aria-label="The day to show"
          className="input !min-h-[40px] w-auto min-w-0 flex-1" />
      </label>
      <button type="submit"
        className="inline-flex min-h-[40px] shrink-0 items-center rounded-[10px] border border-[var(--brand)] bg-[var(--brand)] px-4 text-xs font-semibold text-[var(--on-brand)]">
        Show
      </button>
    </form>
  </Card>;
}
