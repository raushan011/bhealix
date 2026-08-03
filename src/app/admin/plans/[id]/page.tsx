import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, Navigation, Pencil, Phone, TriangleAlert } from "lucide-react";
import { requireAdminPanel } from "@/lib/auth/guard";
import { connectDb } from "@/lib/db/mongoose";
import { RoutePlan } from "@/models/RoutePlan";
import { Visit } from "@/models/Visit";
import { User } from "@/models/User";
import { Badge, Card, LinkButton, PageTitle, Stat, statusTone } from "@/components/ui/kit";
import { PlanAssignment } from "@/components/plans/plan-assignment";
import { DeletePlanButton } from "@/components/plans/delete-plan-button";
import { OBJECT_ID } from "@/lib/api";
import { formatDate, formatDuration, toDisplayTime, WEEKDAYS } from "@/lib/time";
import { directionsUrl, routeUrl } from "@/lib/maps";

export const dynamic = "force-dynamic";

type Stop = {
  sequence: number; distanceFromPreviousKm: number; plannedStart: string; plannedEnd: string;
  withinCallTime: boolean; timingUnknown: boolean;
  doctor?: {
    _id: unknown; name?: string; clinicName?: string; area?: string; city?: string;
    phones?: string[]; location?: { coordinates?: number[] };
  };
};
// weekday/startTime are optional so plans written before those fields existed
// still open instead of erroring.
type PlanDoc = {
  _id: unknown; name: string; date: Date; weekday?: number; status: string; startTime?: string;
  visitMinutes?: number; totalDistanceKm?: number; totalTravelMinutes?: number; stops: Stop[];
  assignedTo?: { _id: unknown; name?: string; employeeId?: string };
};

export default async function PlanDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPanel();
  const { id } = await params;
  if (!OBJECT_ID.test(id)) notFound();

  await connectDb();
  const [plan, visits, team] = await Promise.all([
    RoutePlan.findById(id).populate("assignedTo", "name employeeId")
      .populate("stops.doctor", "name clinicName area city phones location").lean() as Promise<PlanDoc | null>,
    Visit.find({ routePlan: id }).select("doctor status outcome interest samples").lean(),
    User.find({ active: true, role: { $in: ["MR", "SALES"] } }).select("name employeeId role").sort({ name: 1 }).lean()
  ]);
  if (!plan) notFound();

  const visitRows = visits as unknown as Array<{ doctor: unknown; status: string; outcome?: string; interest?: string }>;
  const visitByDoctor = new Map(visitRows.map(visit => [String(visit.doctor), visit]));
  const conflicts = plan.stops.filter(stop => !stop.withinCallTime).length;
  const isDraft = plan.status === "Draft";
  const routeLink = routeUrl([...plan.stops].sort((a, b) => a.sequence - b.sequence).map(stop => stop.doctor));

  return <div className="space-y-5">
    <Link href="/admin/plans" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--brand)]">
      <ArrowLeft size={15} />Back to plans
    </Link>

    <PageTitle title={plan.name}
      subtitle={`${formatDate(plan.date)}${plan.weekday !== undefined && plan.startTime ? ` · ${WEEKDAYS[plan.weekday]} from ${toDisplayTime(plan.startTime)}` : ""}`}
      actions={<>
        <Badge tone={statusTone(plan.status)}>{plan.status}</Badge>
        {routeLink && (
          <a href={routeLink} target="_blank" rel="noreferrer"
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-[10px] border border-[var(--line-2)] bg-white px-4 text-sm font-semibold transition-colors hover:bg-[var(--surface-2)]">
            <ExternalLink size={15} />Open in Maps
          </a>
        )}
        <LinkButton tone="secondary" href={`/admin/plans/new?from=${plan._id}`}>
          <Pencil size={15} />{isDraft ? "Edit draft" : "Edit plan"}
        </LinkButton>
        <DeletePlanButton planId={String(plan._id)} planName={plan.name} redirectTo="/admin/plans" />
      </>} />

    <Card className="grid grid-cols-2 gap-5 p-5 sm:grid-cols-4">
      <Stat label="Stops" value={plan.stops.length} />
      <Stat label="Distance" value={`${plan.totalDistanceKm ?? 0} km`} />
      <Stat label="On the road" value={plan.totalTravelMinutes ? formatDuration(plan.totalTravelMinutes) : "—"} />
      <Stat label="Per doctor" value={plan.visitMinutes ? `${plan.visitMinutes} min` : "—"} />
    </Card>

    {conflicts > 0 && (
      <div className="flex items-start gap-2.5 rounded-[10px] border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <TriangleAlert size={16} className="mt-0.5 shrink-0" />
        <p>{conflicts} stop{conflicts === 1 ? "" : "s"} fall outside the doctor&apos;s call window. Consider rebuilding this plan with an earlier start.</p>
      </div>
    )}

    <PlanAssignment
      planId={String(plan._id)}
      currentAssignee={plan.assignedTo ? { _id: String(plan.assignedTo._id), name: plan.assignedTo.name ?? "" } : null}
      team={team.map(person => {
        const record = person as unknown as { _id: unknown; name: string; employeeId: string; role: string };
        return { _id: String(record._id), name: record.name, employeeId: record.employeeId, role: record.role };
      })}
    />

    <Card className="overflow-hidden">
      <div className="border-b border-[var(--line)] px-5 py-3.5"><h2 className="text-[15px] font-semibold">Visit order</h2></div>
      <ol className="divide-y divide-[var(--line)]">
        {plan.stops.map(stop => {
          const visit = stop.doctor ? visitByDoctor.get(String(stop.doctor._id)) : undefined;
          return <li key={stop.sequence} className={`flex items-start gap-3 px-5 py-4 ${stop.withinCallTime ? "" : "bg-amber-50"}`}>
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--brand)] text-[11px] font-bold text-white">{stop.sequence}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{stop.doctor?.name ?? "Doctor removed"}</p>
              <p className="truncate text-xs text-[var(--muted)]">{[stop.doctor?.clinicName, stop.doctor?.area, stop.doctor?.city].filter(Boolean).join(" · ") || "—"}</p>
              {stop.doctor?.phones?.[0] && (
                <p className="mt-0.5 flex items-center gap-1 text-xs text-[var(--ink-2)]"><Phone size={11} />{stop.doctor.phones[0]}</p>
              )}
              {!stop.withinCallTime && <p className="mt-0.5 text-xs font-medium text-amber-800">Outside the doctor&apos;s call window</p>}
              {stop.timingUnknown && <p className="mt-0.5 text-xs text-[var(--muted)]">No call time recorded</p>}
            </div>
            <div className="shrink-0 text-right">
              <p className="text-xs font-bold text-[var(--brand)]">{toDisplayTime(stop.plannedStart)}</p>
              <p className="text-[11px] text-[var(--muted)]">{stop.sequence === 1 ? "start" : `${stop.distanceFromPreviousKm} km`}</p>
              {visit && <div className="mt-1"><Badge tone={statusTone(visit.status)}>{visit.status}</Badge></div>}
            </div>
            {directionsUrl(stop.doctor) && (
              <a href={directionsUrl(stop.doctor)!} target="_blank" rel="noreferrer" aria-label={`Open ${stop.doctor?.name ?? "this stop"} in Google Maps`}
                className="grid size-9 shrink-0 place-items-center rounded-lg text-[var(--brand)] hover:bg-[var(--brand-soft)]"><Navigation size={15} /></a>
            )}
          </li>;
        })}
      </ol>
    </Card>
  </div>;
}
