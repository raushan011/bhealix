import { requireFieldPanel } from "@/lib/auth/guard";
import { connectDb } from "@/lib/db/mongoose";
import { PageTitle } from "@/components/ui/kit";
import { VisitDayPicker } from "@/components/visits/visit-day-picker";
import { DayInField } from "@/components/visits/day-in-field";
import { dayRange, formatDate, shiftDay, todayIso } from "@/lib/time";
import { loadRounds } from "@/lib/rounds-load";

export const dynamic = "force-dynamic";

/**
 * A rep's own day in the field, told the way the desk sees it.
 *
 * The same screen the admin panel has under Visits → Day view, narrowed to the
 * person reading it: how long they worked, how long of that was inside clinics,
 * the distance between the calls they actually made, what they handed out and
 * what is still to visit. A rep who can see the figures they are judged on can
 * also see them before anybody else does.
 */
export default async function MyDayPage({ searchParams }: {
  searchParams: Promise<{ date?: string }>;
}) {
  const session = await requireFieldPanel();
  const { date } = await searchParams;
  await connectDb();

  const today = todayIso();
  // An unparseable date from the address bar falls back to today rather than to
  // an empty screen that would read as "you did nothing".
  const day = dayRange(date, date) ? date! : today;
  const isToday = day === today;

  const rounds = await loadRounds({ day, employeeId: session.userId });

  const presets = [
    { label: "Today", date: today },
    { label: "Yesterday", date: shiftDay(today, -1) },
    { label: "2 days ago", date: shiftDay(today, -2) }
  ];

  return <div className="space-y-4">
    <PageTitle
      title="My day"
      subtitle={`${formatDate(day)}${isToday ? " · today" : ""} — where you have been, how long it took, and what is still to visit.`}
    />

    <VisitDayPicker presets={presets} date={day} basePath="/employee/visits/day" />

    <DayInField rounds={rounds} day={day} isToday={isToday}
      links={{ doctor: id => `/employee/doctors/${id}` }}
      emptyTitle={`Nothing recorded for ${formatDate(day)}`}
      emptyDescription={isToday
        ? "No plan is assigned to you for today, and you have not registered a call of your own yet."
        : "No plan was assigned to you that day, and you registered no calls."} />
  </div>;
}
