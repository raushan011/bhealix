"use client";

import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Card } from "@/components/ui/kit";

export type DayPreset = { label: string; from: string; to: string };

const chip = (active: boolean) =>
  `min-h-[38px] shrink-0 rounded-full border px-4 text-xs font-semibold leading-[36px] ${
    active
      ? "border-[var(--brand)] bg-[var(--brand)] text-[var(--on-brand)]"
      : "border-[var(--line-2)] bg-[var(--surface)] text-[var(--ink-2)]"
  }`;

/**
 * Narrowing the log to the days somebody is asking about.
 *
 * Sixty visits is two days' work for a team of any size, so the list on its own
 * answers "what happened this morning?" only by scrolling. The named days cover
 * what is asked for nearly every time — how did today go, what did yesterday
 * look like — and the two boxes are there for the month somebody is closing.
 *
 * The days in hand are passed down rather than read back out of the address bar
 * with `useSearchParams`: the page has already been rendered for them, so
 * reading them again would need a Suspense boundary around this row, and one
 * that re-suspends on every choice tore its own DOM out from under React on the
 * second click. Props also keep the boxes in step with the list beneath them,
 * which is the thing a reader would notice.
 */
export function VisitDateFilter({ presets, from, to, status }: {
  presets: DayPreset[];
  /** The days the page was rendered for — already checked, never raw input. */
  from: string; to: string;
  /** Carried through, so choosing a day does not quietly widen the status tab. */
  status?: string;
}) {
  const router = useRouter();

  function apply(nextFrom: string, nextTo: string) {
    const query = new URLSearchParams({
      ...(status ? { status } : {}), ...(nextFrom ? { from: nextFrom } : {}), ...(nextTo ? { to: nextTo } : {})
    }).toString();
    router.push(query ? `/admin/visits?${query}` : "/admin/visits");
  }

  return <Card className="space-y-3 p-4">
    <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
      <button onClick={() => apply("", "")} className={chip(!from && !to)}>Any day</button>
      {presets.map(preset => (
        <button key={preset.label} onClick={() => apply(preset.from, preset.to)}
          className={chip(from === preset.from && to === preset.to)}>{preset.label}</button>
      ))}
    </div>

    {/* An open end is a real question — "everything since Monday" — so neither
        box is required, and one on its own filters from or up to that day. */}
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none">
        <span className="shrink-0 text-xs font-medium text-[var(--muted)]">From</span>
        <input type="date" value={from} max={to || undefined} aria-label="Visits from"
          onChange={event => apply(event.target.value, to)} className="input !min-h-[40px] w-auto min-w-0 flex-1" />
      </label>
      <label className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none">
        <span className="shrink-0 text-xs font-medium text-[var(--muted)]">To</span>
        <input type="date" value={to} min={from || undefined} aria-label="Visits up to"
          onChange={event => apply(from, event.target.value)} className="input !min-h-[40px] w-auto min-w-0 flex-1" />
      </label>
      {(from || to) && (
        <button onClick={() => apply("", "")}
          className="inline-flex min-h-[40px] shrink-0 items-center gap-1 rounded-[10px] px-2 text-xs font-semibold text-[var(--brand)]">
          <X size={13} />Clear
        </button>
      )}
    </div>
  </Card>;
}
