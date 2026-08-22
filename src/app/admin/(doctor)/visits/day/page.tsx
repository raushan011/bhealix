import { requireAdminPanel } from "@/lib/auth/guard";
import { connectDb } from "@/lib/db/mongoose";
import { PageTitle } from "@/components/ui/kit";
import { VisitDayPicker } from "@/components/visits/visit-day-picker";
import { DayInField } from "@/components/visits/day-in-field";
import { dayRange, formatDate, shiftDay, todayIso } from "@/lib/time";
import { loadRounds } from "@/lib/rounds-load";

export const dynamic = "force-dynamic";

/**
 * One day in the field, rep by rep, as it actually went.
 *
 * The Visits log next door is a feed — every call ever recorded, newest first,
 * filterable. Useful for "what did we do at Dr Mehta's in June" and no use at all
 * for the question a desk asks at four in the afternoon: *is the round
 * happening?* That needs one day, grouped by the person walking it, in the order
 * things actually occurred, with what is still outstanding at the bottom.
 *
 * Deliberately not the route plan. A plan is nine stops in distance order with
 * tidy slots; a real day is six of them in a different order, one clinic closed,
 * an unplanned call at noon and three still to go. `lib/rounds` does the
 * arithmetic, `lib/rounds-load` the querying, and `DayInField` the drawing —
 * the rep's own copy of this screen in the field panel shares all three.
 */
export default async function VisitDayPage({ searchParams }: {
  searchParams: Promise<{ date?: string }>;
}) {
  await requireAdminPanel();
  const { date } = await searchParams;
  await connectDb();

  const today = todayIso();
  // An unparseable date from the address bar falls back to today rather than to
  // an empty screen somebody would read as "nobody worked".
  const day = dayRange(date, date) ? date! : today;
  const isToday = day === today;

  const rounds = await loadRounds({ day });

  const presets = [
    { label: "Today", date: today },
    { label: "Yesterday", date: shiftDay(today, -1) },
    { label: "2 days ago", date: shiftDay(today, -2) }
  ];

  return <div className="space-y-5">
    <PageTitle
      title="The day in the field"
      subtitle={`${formatDate(day)}${isToday ? " · today" : ""} — who is out, where they have got to, and what is still to visit.`}
    />

    {/* Plain anchors, as on the Visits log, so the list repaints with the tab. */}
    <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
      <a href="/admin/visits"
        className="min-h-[38px] shrink-0 rounded-full border border-[var(--line-2)] bg-[var(--surface)] px-4 text-xs font-semibold leading-[36px] text-[var(--ink-2)]">
        Visit log
      </a>
      <span className="min-h-[38px] shrink-0 rounded-full border border-[var(--brand)] bg-[var(--brand)] px-4 text-xs font-semibold leading-[36px] text-[var(--on-brand)]">
        Day view
      </span>
    </div>

    <VisitDayPicker presets={presets} date={day} basePath="/admin/visits/day" />

    <DayInField rounds={rounds} day={day} isToday={isToday}
      links={{ doctor: id => `/admin/doctors/${id}`, employee: id => `/admin/team/${id}/activity` }} />
  </div>;
}
