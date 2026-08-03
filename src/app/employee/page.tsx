import Link from "next/link";
import { CalendarCheck, ChevronRight, Clock, MapPin, Navigation, Phone, Route } from "lucide-react";
import { requireFieldPanel } from "@/lib/auth/guard";
import { connectDb } from "@/lib/db/mongoose";
import { Visit } from "@/models/Visit";
import { RoutePlan } from "@/models/RoutePlan";
import { Badge, Card, EmptyState, PageTitle, statusTone } from "@/components/ui/kit";
import { formatDate, toDisplayTime, WEEKDAYS } from "@/lib/time";
import { callTimeOn } from "@/components/doctors/doctor-picker";
import type { EditableWindow } from "@/components/doctors/call-schedule-editor";

export const dynamic = "force-dynamic";

type VisitDoc = {
  _id: unknown; plannedStart?: string; status: string;
  doctor?: {
    _id: unknown; name?: string; clinicName?: string; area?: string; city?: string;
    phones?: string[]; fullAddress?: string; location?: { coordinates?: number[] }; callSchedule?: EditableWindow[];
  };
};
type PlanDoc = { _id: unknown; name: string; totalDistanceKm: number; stops: unknown[] };

export default async function TodayPage() {
  const session = await requireFieldPanel();
  await connectDb();

  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(); end.setHours(23, 59, 59, 999);
  const weekday = new Date().getDay();

  const [visits, plan] = await Promise.all([
    Visit.find({ employee: session.userId, plannedDate: { $gte: start, $lte: end } })
      .populate("doctor", "name clinicName area city phones fullAddress location callSchedule")
      .sort({ plannedStart: 1 }).lean() as unknown as Promise<VisitDoc[]>,
    RoutePlan.findOne({ assignedTo: session.userId, date: { $gte: start, $lte: end } })
      .select("name totalDistanceKm stops").lean() as Promise<PlanDoc | null>
  ]);

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
          <span className="grid size-11 place-items-center rounded-full bg-white text-xs font-bold">{progress}%</span>
        </div>
      </Card>
    )}

    {next?.doctor && (
      <section>
        <h2 className="mb-2 text-[15px] font-semibold">Up next</h2>
        <div className="rounded-[14px] bg-[var(--brand)] p-4 text-white">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-semibold">{next.doctor.name}</p>
              <p className="mt-0.5 truncate text-sm text-white/75">{[next.doctor.clinicName, next.doctor.area].filter(Boolean).join(" · ") || "—"}</p>
            </div>
            {next.plannedStart && <span className="shrink-0 rounded-full bg-white/15 px-2.5 py-1 text-xs font-bold">{toDisplayTime(next.plannedStart)}</span>}
          </div>

          <p className="mt-3 flex items-center gap-1.5 text-sm text-white/85">
            <Clock size={14} />{callTimeOn(next.doctor as never, weekday) ?? `No call time for ${WEEKDAYS[weekday]}`}
          </p>
          <p className="mt-1 flex items-start gap-1.5 text-sm text-white/75">
            <MapPin size={14} className="mt-0.5 shrink-0" /><span className="line-clamp-2">{next.doctor.fullAddress || [next.doctor.area, next.doctor.city].filter(Boolean).join(", ") || "Address not recorded"}</span>
          </p>

          <div className="mt-4 grid grid-cols-[1fr_48px_48px] gap-2">
            <Link href={`/employee/visits/${next._id}`}
              className="tap flex items-center justify-center gap-2 rounded-[10px] bg-white font-semibold text-[var(--brand)]">
              {next.status === "In progress" ? "Continue visit" : "Start visit"}
            </Link>
            {next.doctor.phones?.[0] ? (
              <a href={`tel:${next.doctor.phones[0]}`} aria-label="Call doctor" className="tap grid place-items-center rounded-[10px] bg-white/15"><Phone size={18} /></a>
            ) : <span className="tap grid place-items-center rounded-[10px] bg-white/5 text-white/30"><Phone size={18} /></span>}
            {next.doctor.location?.coordinates?.length === 2 ? (
              <a href={`https://www.google.com/maps/dir/?api=1&destination=${next.doctor.location.coordinates[1]},${next.doctor.location.coordinates[0]}`}
                target="_blank" rel="noreferrer" aria-label="Navigate" className="tap grid place-items-center rounded-[10px] bg-white/15"><Navigation size={18} /></a>
            ) : <span className="tap grid place-items-center rounded-[10px] bg-white/5 text-white/30"><Navigation size={18} /></span>}
          </div>
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
                visit.status === "Completed" ? "bg-emerald-600 text-white" : visit.status === "Missed" ? "bg-rose-500 text-white" : "bg-[var(--brand)] text-white"
              }`}>{index + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{visit.doctor?.name ?? "Doctor removed"}</p>
                <p className="truncate text-xs text-[var(--muted)]">{[visit.doctor?.clinicName, visit.doctor?.area].filter(Boolean).join(" · ") || "—"}</p>
                <p className="mt-0.5 flex items-center gap-1 text-xs text-[var(--brand)]">
                  <Clock size={11} />{visit.plannedStart ? toDisplayTime(visit.plannedStart) : "No time set"}
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
          description="When your administrator assigns you a route plan, your day appears here in visiting order." />
      )}
    </section>

    {plan && (
      <Link href="/employee/history" className="card tap flex items-center justify-center gap-2 text-sm font-semibold">
        <Route size={16} />See past visits
      </Link>
    )}
  </div>;
}
