import Link from "next/link";
import { CalendarCheck, CalendarClock, ChevronRight, Clock, IndianRupee, MapPin, Navigation, Phone, Route } from "lucide-react";
import { requireFieldPanel } from "@/lib/auth/guard";
import { connectDb } from "@/lib/db/mongoose";
import { Visit } from "@/models/Visit";
import { RoutePlan } from "@/models/RoutePlan";
import { Invoice } from "@/models/Invoice";
import { Badge, Card, EmptyState, LinkButton, PageTitle, statusTone } from "@/components/ui/kit";
import { doctorMapsUrl } from "@/lib/doctors/maps";
import { formatMoney } from "@/lib/billing/constants";
import { dayOf, endOfDay, formatDate, shiftDay, startOfDay, todayIso, todayRange, toDisplayTime, weekdayOf, WEEKDAYS } from "@/lib/time";
import { RegisterVisit } from "@/components/visits/register-visit";
import { callTimeOn } from "@/lib/doctors/call-schedule";
import type { EditableWindow } from "@/components/doctors/call-schedule-editor";

export const dynamic = "force-dynamic";

type VisitDoc = {
  _id: unknown; plannedStart?: string; status: string; routePlan?: unknown;
  doctor?: {
    _id: unknown; name?: string; clinicName?: string; area?: string; city?: string;
    phones?: string[]; fullAddress?: string; location?: { coordinates?: number[] }; callSchedule?: EditableWindow[];
  };
};
type PlanDoc = { _id: unknown; name: string; totalDistanceKm: number; stops: unknown[] };
type FollowUpDoc = {
  _id: unknown; followUpDate: Date;
  doctor?: {
    _id: unknown; name?: string; clinicName?: string; area?: string; city?: string;
    phones?: string[]; fullAddress?: string; location?: { coordinates?: number[] };
  };
};
type DueBillDoc = {
  _id: unknown; invoiceNo: string; balanceDue: number; dueDate?: Date; followUpDate?: Date;
  billTo?: { name?: string; clinicName?: string };
};
type UpcomingPlan = { _id: unknown; name: string; date: Date; totalDistanceKm?: number; stops?: unknown[] };

export default async function TodayPage() {
  const session = await requireFieldPanel();
  await connectDb();

  // The day the rep is having, not the one the server is. A machine keeping UTC
  // would call their first calls of the morning yesterday's work.
  const today = todayRange();
  const weekday = weekdayOf(todayIso());

  /*
   * The reminder window: what falls due in the next three days, and what is
   * already overdue by up to a week. Narrow on purpose — a rep planning a day
   * wants "who is due around now", and a promise from March is the History
   * screen's business, not the morning's.
   */
  const horizon = endOfDay(shiftDay(todayIso(), 3));
  const lookback = startOfDay(shiftDay(todayIso(), -7));

  const [visits, plan, upcoming, followUps, dueBills] = await Promise.all([
    Visit.find({ employee: session.userId, plannedDate: today })
      .populate("doctor", "name clinicName area city phones fullAddress location callSchedule")
      .sort({ plannedStart: 1 }).lean() as unknown as Promise<VisitDoc[]>,
    RoutePlan.findOne({ assignedTo: session.userId, date: today })
      .select("name totalDistanceKm stops").lean() as Promise<PlanDoc | null>,
    // Plans for later days are shown here too, so a route assigned today for
    // tomorrow is visible straight away instead of only on the morning it runs.
    RoutePlan.find({ assignedTo: session.userId, date: { $gt: today.$lte } })
      .select("name date totalDistanceKm stops").sort({ date: 1 }).limit(3)
      .lean() as unknown as Promise<UpcomingPlan[]>,
    Visit.find({ employee: session.userId, status: "Completed", followUpDate: { $gte: lookback, $lte: horizon } })
      .populate("doctor", "name clinicName area city phones fullAddress location")
      .sort({ followUpDate: 1 }).limit(12).lean() as unknown as Promise<FollowUpDoc[]>,
    Invoice.find({
      employee: session.userId,
      status: { $in: ["Unpaid", "Partially paid"] },
      balanceDue: { $gt: 0 },
      $or: [{ dueDate: { $lte: horizon } }, { followUpDate: { $lte: horizon } }]
    }).select("invoiceNo balanceDue dueDate followUpDate billTo.name billTo.clinicName")
      .sort({ dueDate: 1 }).limit(8).lean() as unknown as Promise<DueBillDoc[]>
  ]);

  /*
   * One reminder per doctor, the earliest. Three visits that each promised a
   * follow-up are one door to knock on, not three rows saying so.
   */
  const followUpByDoctor = new Map<string, FollowUpDoc>();
  for (const followUp of followUps) {
    const key = String(followUp.doctor?._id ?? followUp._id);
    if (!followUpByDoctor.has(key)) followUpByDoctor.set(key, followUp);
  }
  const reminders = [...followUpByDoctor.values()].slice(0, 6);

  /** "3 days overdue", "today", "in 2 days" — the words a reminder is scanned by. */
  const dueLabel = (value: Date) => {
    // The day as the rep reads it, not as the server's clock slices it (§lib/time).
    const diff = Math.round((startOfDay(todayIso()).getTime() - startOfDay(dayOf(value)).getTime()) / 86_400_000);
    if (diff > 0) return { text: diff === 1 ? "1 day overdue" : `${diff} days overdue`, tone: "danger" as const };
    if (diff === 0) return { text: "today", tone: "warn" as const };
    return { text: diff === -1 ? "tomorrow" : `in ${-diff} days`, tone: "info" as const };
  };

  const done = visits.filter(visit => visit.status === "Completed" || visit.status === "Missed").length;
  const progress = visits.length ? Math.round((done / visits.length) * 100) : 0;
  const next = visits.find(visit => visit.status === "Planned" || visit.status === "In progress");

  return <div className="space-y-4">
    <PageTitle title={`Good day, ${session.name.split(" ")[0]}`} subtitle={formatDate(new Date())} />

    {visits.length > 0 && (
      <Card className="flex items-center justify-between p-4">
        <div>
          <p className="text-xs text-[var(--muted)]">Today&apos;s progress</p>
          <p className="mt-0.5 text-lg font-semibold">{done} of {visits.length} done</p>
          {plan && <p className="mt-0.5 text-xs text-[var(--muted)]">{plan.name} · {plan.totalDistanceKm} km</p>}
        </div>
        <div className="grid size-14 shrink-0 place-items-center rounded-full"
          style={{ background: `conic-gradient(var(--brand) ${progress}%, var(--line) 0)` }}>
          <span className="grid size-11 place-items-center rounded-full bg-[var(--surface)] text-xs font-bold">{progress}%</span>
        </div>
      </Card>
    )}

    {next?.doctor && (
      <section>
        <h2 className="mb-2 text-[15px] font-semibold">Up next</h2>
        <div className="rounded-[14px] bg-[var(--brand)] p-4 text-[var(--on-brand)]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-semibold">{next.doctor.name}</p>
              <p className="mt-0.5 truncate text-sm text-[var(--on-brand)]/75">{[next.doctor.clinicName, next.doctor.area].filter(Boolean).join(" · ") || "—"}</p>
            </div>
            {next.plannedStart && <span className="shrink-0 rounded-full bg-[var(--on-brand)]/15 px-2.5 py-1 text-xs font-bold">{toDisplayTime(next.plannedStart)}</span>}
          </div>

          <p className="mt-3 flex items-center gap-1.5 text-sm text-[var(--on-brand)]/85">
            <Clock size={14} />{callTimeOn(next.doctor as never, weekday) ?? `No call time for ${WEEKDAYS[weekday]}`}
          </p>
          <p className="mt-1 flex items-start gap-1.5 text-sm text-[var(--on-brand)]/75">
            <MapPin size={14} className="mt-0.5 shrink-0" /><span className="line-clamp-2">{next.doctor.fullAddress || [next.doctor.area, next.doctor.city].filter(Boolean).join(", ") || "Address not recorded"}</span>
          </p>

          <div className="mt-4 grid grid-cols-[1fr_48px_48px] gap-2">
            <Link href={`/employee/visits/${next._id}`}
              className="tap flex items-center justify-center gap-2 rounded-[10px] bg-[var(--surface)] font-semibold text-[var(--brand)]">
              {next.status === "In progress" ? "Continue visit" : "Start visit"}
            </Link>
            {next.doctor.phones?.[0] ? (
              <a href={`tel:${next.doctor.phones[0]}`} aria-label="Call doctor" className="tap grid place-items-center rounded-[10px] bg-[var(--on-brand)]/15"><Phone size={18} /></a>
            ) : <span className="tap grid place-items-center rounded-[10px] bg-[var(--on-brand)]/10 text-[var(--on-brand)]/40"><Phone size={18} /></span>}
            {next.doctor.location?.coordinates?.length === 2 ? (
              <a href={`https://www.google.com/maps/dir/?api=1&destination=${next.doctor.location.coordinates[1]},${next.doctor.location.coordinates[0]}`}
                target="_blank" rel="noreferrer" aria-label="Navigate" className="tap grid place-items-center rounded-[10px] bg-[var(--on-brand)]/15"><Navigation size={18} /></a>
            ) : <span className="tap grid place-items-center rounded-[10px] bg-[var(--on-brand)]/10 text-[var(--on-brand)]/40"><Navigation size={18} /></span>}
          </div>
        </div>
      </section>
    )}

    {/* Above the day's list, not buried under it: a rep reaches for this while
        standing outside a clinic that is not on the plan, and half the value is
        lost if they have to scroll past the plan to find it. */}
    <RegisterVisit />

    {(reminders.length > 0 || dueBills.length > 0) && (
      <section>
        <h2 className="mb-2 text-[15px] font-semibold">Due soon</h2>
        <div className="space-y-2">
          {reminders.map(reminder => {
            const doctor = reminder.doctor;
            const due = dueLabel(reminder.followUpDate);
            const maps = doctor ? doctorMapsUrl({
              coordinates: doctor.location?.coordinates,
              name: doctor.name, clinicName: doctor.clinicName,
              fullAddress: doctor.fullAddress, area: doctor.area, city: doctor.city
            }) : null;
            return <Card key={String(reminder._id)} className="p-3.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  {doctor ? (
                    <Link href={`/employee/doctors/${doctor._id}`} className="block truncate text-sm font-semibold">{doctor.name}</Link>
                  ) : <p className="text-sm font-semibold">Doctor removed</p>}
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-[var(--muted)]">
                    <CalendarClock size={11} />Follow-up promised {formatDate(reminder.followUpDate)}
                  </p>
                </div>
                <Badge tone={due.tone}>{due.text}</Badge>
              </div>
              <div className="mt-2.5 flex gap-2">
                {maps && (
                  <a href={maps} target="_blank" rel="noreferrer"
                    className="tap inline-flex flex-1 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--line-2)] px-3 text-xs font-semibold">
                    <Navigation size={13} />Map
                  </a>
                )}
                {doctor?.phones?.[0] && (
                  <a href={`tel:${doctor.phones[0]}`}
                    className="tap inline-flex flex-1 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--line-2)] px-3 text-xs font-semibold">
                    <Phone size={13} />Call
                  </a>
                )}
                {doctor && (
                  <Link href={`/employee/doctors/${doctor._id}`}
                    className="tap inline-flex flex-1 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--line-2)] px-3 text-xs font-semibold">
                    Visit
                  </Link>
                )}
              </div>
            </Card>;
          })}

          {dueBills.map(bill => {
            const when = bill.dueDate ?? bill.followUpDate;
            const due = when ? dueLabel(when) : null;
            return <Link key={String(bill._id)} href={`/employee/bills/${bill._id}`}
              className="card flex items-center gap-3 p-3.5 active:bg-[var(--surface-2)]">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--warn-bg)] text-[var(--warn-ink)]">
                <IndianRupee size={15} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{bill.billTo?.name || bill.billTo?.clinicName || bill.invoiceNo}</p>
                <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
                  {bill.invoiceNo} · {formatMoney(bill.balanceDue)} to collect
                </p>
              </div>
              {due && <Badge tone={due.tone}>{due.text}</Badge>}
              <ChevronRight size={16} className="shrink-0 text-[var(--muted)]" />
            </Link>;
          })}
        </div>
      </section>
    )}

    <section>
      <h2 className="mb-2 text-[15px] font-semibold">Today&apos;s route</h2>
      {visits.length ? (
        <div className="space-y-2">
          {visits.map((visit, index) => (
            <Link key={String(visit._id)} href={`/employee/visits/${visit._id}`}
              className="card flex items-center gap-3 p-3.5 active:bg-[var(--surface-2)]">
              <span className={`grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-bold ${
                visit.status === "Completed" ? "bg-[var(--ok-ink)] text-[var(--on-brand)]" : visit.status === "Missed" ? "bg-[var(--danger-ink)] text-[var(--on-brand)]" : "bg-[var(--brand)] text-[var(--on-brand)]"
              }`}>{index + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{visit.doctor?.name ?? "Doctor removed"}</p>
                <p className="truncate text-xs text-[var(--muted)]">{[visit.doctor?.clinicName, visit.doctor?.area].filter(Boolean).join(" · ") || "—"}</p>
                <p className="mt-0.5 flex items-center gap-1 text-xs text-[var(--brand)]">
                  <Clock size={11} />{visit.plannedStart ? toDisplayTime(visit.plannedStart) : "No time set"}
                  {/* No route plan behind it is what makes a visit unplanned —
                      nothing else creates one, so there is no second field to
                      keep in step with this. */}
                  {!visit.routePlan && <span className="text-[var(--muted)]"> · unplanned</span>}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge tone={statusTone(visit.status)}>{visit.status}</Badge>
                <ChevronRight size={16} className="text-[var(--muted)]" />
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState icon={CalendarCheck} title="Nothing scheduled today"
          description="When your administrator assigns you a route plan, your day appears here in visiting order. A call you make without one can be registered above."
          action={<LinkButton tone="secondary" href="/employee/plans"><Route size={16} />See my plans</LinkButton>} />
      )}
    </section>

    {upcoming.length > 0 && (
      <section>
        <h2 className="mb-2 text-[15px] font-semibold">Coming up</h2>
        <div className="space-y-2">
          {upcoming.map(next => (
            <Link key={String(next._id)} href={`/employee/plans/${next._id}`}
              className="card flex items-center gap-3 p-3.5 active:bg-[var(--surface-2)]">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]"><Route size={16} /></span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{next.name}</p>
                <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
                  {formatDate(next.date)} · {next.stops?.length ?? 0} stops · {next.totalDistanceKm ?? 0} km
                </p>
              </div>
              <ChevronRight size={16} className="shrink-0 text-[var(--muted)]" />
            </Link>
          ))}
        </div>
      </section>
    )}

    {plan && (
      <Link href="/employee/history" className="card tap flex items-center justify-center gap-2 text-sm font-semibold">
        <Route size={16} />See past visits
      </Link>
    )}
  </div>;
}
