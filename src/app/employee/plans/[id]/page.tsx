import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock, ExternalLink, Navigation, Phone, TriangleAlert } from "lucide-react";
import { requireFieldPanel } from "@/lib/auth/guard";
import { connectDb } from "@/lib/db/mongoose";
import { RoutePlan } from "@/models/RoutePlan";
import { Visit } from "@/models/Visit";
import { Badge, Card, PageTitle, Stat, statusTone } from "@/components/ui/kit";
import { OBJECT_ID } from "@/lib/api";
import { directionsUrl, routeUrl } from "@/lib/maps";
import { formatDate, formatDuration, toDisplayTime, WEEKDAYS } from "@/lib/time";

export const dynamic = "force-dynamic";

type Stop = {
  sequence: number; distanceFromPreviousKm: number; plannedStart: string;
  withinCallTime: boolean; timingUnknown: boolean;
  doctor?: {
    _id: unknown; name?: string; clinicName?: string; area?: string; city?: string;
    phones?: string[]; fullAddress?: string; location?: { coordinates?: number[] };
  };
};
type PlanDoc = {
  _id: unknown; name: string; date: Date; weekday?: number; status: string; startTime?: string;
  totalDistanceKm?: number; totalTravelMinutes?: number; stops: Stop[]; assignedTo?: unknown;
};

export default async function MyPlanDetail({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireFieldPanel();
  const { id } = await params;
  if (!OBJECT_ID.test(id)) notFound();

  await connectDb();
  const plan = await RoutePlan.findById(id)
    .populate("stops.doctor", "name clinicName area city phones fullAddress location")
    .lean() as PlanDoc | null;

  // A rep only ever opens their own plans.
  if (!plan || String(plan.assignedTo ?? "") !== session.userId) notFound();

  const visits = await Visit.find({ routePlan: plan._id, employee: session.userId })
    .select("doctor status").lean() as unknown as Array<{ _id: unknown; doctor: unknown; status: string }>;
  const visitByDoctor = new Map(visits.map(visit => [String(visit.doctor), visit]));

  const stops = [...plan.stops].sort((a, b) => a.sequence - b.sequence);
  const conflicts = stops.filter(stop => !stop.withinCallTime).length;
  const routeLink = routeUrl(stops.map(stop => stop.doctor));

  return <div className="space-y-4">
    <Link href="/employee/plans" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--brand)]">
      <ArrowLeft size={15} />Back to my plans
    </Link>

    <PageTitle title={plan.name}
      subtitle={`${formatDate(plan.date)}${plan.weekday !== undefined && plan.startTime ? ` · ${WEEKDAYS[plan.weekday]} from ${toDisplayTime(plan.startTime)}` : ""}`}
      actions={<Badge tone={statusTone(plan.status)}>{plan.status}</Badge>} />

    <Card className="grid grid-cols-3 gap-4 p-4">
      <Stat label="Stops" value={stops.length} />
      <Stat label="Distance" value={`${plan.totalDistanceKm ?? 0} km`} />
      <Stat label="On the road" value={plan.totalTravelMinutes ? formatDuration(plan.totalTravelMinutes) : "—"} />
    </Card>

    {routeLink && (
      <a href={routeLink} target="_blank" rel="noreferrer"
        className="card tap flex items-center justify-center gap-2 text-sm font-semibold text-[var(--brand)]">
        <ExternalLink size={15} />Open the whole route in Google Maps
      </a>
    )}

    {conflicts > 0 && (
      <div className="flex items-start gap-2.5 rounded-[10px] border border-[var(--warn-line)] bg-[var(--warn-bg)] p-3 text-sm text-[var(--warn-ink)]">
        <TriangleAlert size={16} className="mt-0.5 shrink-0" />
        <p>{conflicts} stop{conflicts === 1 ? "" : "s"} fall outside the doctor&apos;s usual call window. Call ahead before you travel.</p>
      </div>
    )}

    <section>
      <h2 className="mb-2 text-[15px] font-semibold">Visit order</h2>
      <ol className="space-y-2">
        {stops.map(stop => {
          const visit = stop.doctor ? visitByDoctor.get(String(stop.doctor._id)) : undefined;
          const maps = directionsUrl(stop.doctor);
          return <li key={stop.sequence} className={`card p-3.5 ${stop.withinCallTime ? "" : "border-[var(--warn-line)] bg-[var(--warn-bg)]"}`}>
            <div className="flex items-start gap-3">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--brand)] text-[11px] font-bold text-[var(--on-brand)]">{stop.sequence}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{stop.doctor?.name ?? "Doctor removed"}</p>
                <p className="truncate text-xs text-[var(--muted)]">{[stop.doctor?.clinicName, stop.doctor?.area].filter(Boolean).join(" · ") || "—"}</p>
                <p className="mt-0.5 flex items-center gap-1 text-xs text-[var(--brand)]">
                  <Clock size={11} />{toDisplayTime(stop.plannedStart)}
                  <span className="text-[var(--muted)]">· {stop.sequence === 1 ? "start" : `${stop.distanceFromPreviousKm} km`}</span>
                </p>
                {stop.timingUnknown && <p className="mt-0.5 text-xs text-[var(--muted)]">Call time not recorded — confirm on the visit</p>}
              </div>
              {visit && <Badge tone={statusTone(visit.status)}>{visit.status}</Badge>}
            </div>

            <div className="mt-3 flex gap-2">
              {visit ? (
                <Link href={`/employee/visits/${visit._id}`}
                  className="tap flex flex-1 items-center justify-center rounded-[10px] bg-[var(--brand)] text-sm font-semibold text-[var(--on-brand)]">
                  {visit.status === "Completed" || visit.status === "Missed" ? "View visit" : "Open visit"}
                </Link>
              ) : (
                <span className="tap flex flex-1 items-center justify-center rounded-[10px] bg-[var(--surface-2)] text-sm font-semibold text-[var(--muted)]">
                  No visit record
                </span>
              )}
              {stop.doctor?.phones?.[0] && (
                <a href={`tel:${stop.doctor.phones[0]}`} aria-label={`Call ${stop.doctor.name ?? "doctor"}`}
                  className="tap grid w-12 place-items-center rounded-[10px] border border-[var(--line-2)]"><Phone size={16} /></a>
              )}
              {maps && (
                <a href={maps} target="_blank" rel="noreferrer" aria-label={`Navigate to ${stop.doctor?.name ?? "this stop"}`}
                  className="tap grid w-12 place-items-center rounded-[10px] border border-[var(--line-2)] text-[var(--brand)]"><Navigation size={16} /></a>
              )}
            </div>
          </li>;
        })}
      </ol>
    </section>
  </div>;
}
