import { Card } from "@/components/ui/kit";

export type DayPreset = { label: string; from: string; to: string };

/** What the sample dropdown can be set to, beyond a product's own name. */
export const SAMPLE_ANY = "__any";
export const SAMPLE_NONE = "__none";

const chip = (active: boolean) =>
  `inline-flex min-h-[38px] shrink-0 items-center rounded-full border px-4 text-xs font-semibold ${
    active
      ? "border-[var(--brand)] bg-[var(--brand)] text-[var(--on-brand)]"
      : "border-[var(--line-2)] bg-[var(--surface)] text-[var(--ink-2)]"
  }`;

/**
 * Narrowing the log to the days — and the samples — somebody is asking about.
 *
 * Sixty visits is two days' work for a team of any size, so the list on its own
 * answers "what happened this morning?" only by scrolling. The named days cover
 * what is asked for nearly every time; the two boxes are there for the month
 * somebody is closing, and the sample dropdown for the question stock raises —
 * where did the Vitamin C serum actually go.
 *
 * A form and plain links rather than `<Link>` and `router.push`. Client-side
 * navigation does not currently repaint this panel: the address changes and the
 * list beneath it stays as it was, which on a date filter reads as "there were
 * no visits that day" and is worse than a slow answer. This also means the
 * whole row works with no JavaScript at all, and that `Apply` is an ordinary
 * submit button rather than something that has to be wired up.
 *
 * The named days apply on the spot because a chip that needed confirming would
 * be a worse chip. The boxes and the dropdown wait for `Apply`, because a range
 * is half-typed for most of the time it takes to enter, and reloading on every
 * keystroke of a date is unusable.
 */
export function VisitDateFilter({ presets, from, to, anyDay, sample, status, products }: {
  presets: DayPreset[];
  /** Whether the reader asked for the whole log rather than the default day. */
  anyDay: boolean;
  /** The days the page was rendered for — already checked, never raw input. */
  from: string; to: string;
  /** The sample filter in force: a product name, or one of the two specials. */
  sample: string;
  /** Carried through, so choosing a day does not quietly widen the status tab. */
  status?: string;
  /** Every product that could have been handed out, for the dropdown. */
  products: string[];
}) {
  const href = (next: { from?: string; to?: string; sample?: string; all?: boolean }) => {
    const query = new URLSearchParams({
      ...(status ? { status } : {}),
      ...(next.all ? { all: "1" } : {}),
      ...(next.from ? { from: next.from } : {}),
      ...(next.to ? { to: next.to } : {}),
      ...(next.sample ? { sample: next.sample } : {})
    }).toString();
    return query ? `/admin/visits?${query}` : "/admin/visits";
  };

  const filtered = Boolean(anyDay || from || to || sample);

  return <Card className="space-y-3 p-4">
    <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
      {/* The log opens on today, so "any day" has to be asked for by name. */}
      <a href={href({ sample, all: true })} className={chip(anyDay && !from && !to)}>Any day</a>
      {presets.map(preset => (
        <a key={preset.label} href={href({ from: preset.from, to: preset.to, sample })}
          className={chip(from === preset.from && to === preset.to)}>{preset.label}</a>
      ))}
    </div>

    {/* An open end is a real question — "everything since Monday" — so neither
        box is required, and one on its own filters from or up to that day. */}
    <form action="/admin/visits" method="get" className="flex flex-wrap items-center gap-2">
      {status && <input type="hidden" name="status" value={status} />}
      {/* Boxes left empty mean the whole log, not today — that is what
          clearing a date in a form has always meant. */}
      <input type="hidden" name="all" value="1" />

      <label className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none">
        <span className="shrink-0 text-xs font-medium text-[var(--muted)]">From</span>
        <input type="date" name="from" defaultValue={from} aria-label="Visits from"
          className="input !min-h-[40px] w-auto min-w-0 flex-1" />
      </label>
      <label className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none">
        <span className="shrink-0 text-xs font-medium text-[var(--muted)]">To</span>
        <input type="date" name="to" defaultValue={to} aria-label="Visits up to"
          className="input !min-h-[40px] w-auto min-w-0 flex-1" />
      </label>

      <label className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none">
        <span className="shrink-0 text-xs font-medium text-[var(--muted)]">Sample</span>
        <select name="sample" defaultValue={sample} aria-label="Sample handed out"
          className="select !min-h-[40px] w-auto min-w-0 flex-1">
          <option value="">Any or none</option>
          <option value={SAMPLE_ANY}>Any sample given</option>
          <option value={SAMPLE_NONE}>No sample given</option>
          {products.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>

      <button type="submit"
        className="inline-flex min-h-[40px] shrink-0 items-center rounded-[10px] border border-[var(--brand)] bg-[var(--brand)] px-4 text-xs font-semibold text-[var(--on-brand)]">
        Apply
      </button>
      {filtered && (
        <a href={href({})}
          className="inline-flex min-h-[40px] shrink-0 items-center rounded-[10px] px-2 text-xs font-semibold text-[var(--brand)]">
          Clear
        </a>
      )}
    </form>
  </Card>;
}
