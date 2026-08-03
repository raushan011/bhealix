import Link from "next/link";
import { CalendarRange, Clock, Plus, TriangleAlert } from "lucide-react";
import { requireAdminPanel } from "@/lib/auth/guard";
import { connectDb } from "@/lib/db/mongoose";
import { RoutePlan } from "@/models/RoutePlan";
import { Badge, Card, EmptyState, LinkButton, PageTitle, statusTone } from "@/components/ui/kit";
import { DeletePlanButton } from "@/components/plans/delete-plan-button";
import { formatDate, toDisplayTime, WEEKDAYS } from "@/lib/time";

export const dynamic = "force-dynamic";

// weekday/startTime are optional: plans created before those fields existed
// are still listed rather than breaking the page.
type PlanDoc = {
  _id: unknown; name: string; date: Date; weekday?: number; status: string; startTime?: string;
  totalDistanceKm?: number; stops?: Array<{ withinCallTime?: boolean }>; assignedTo?: { name?: string; employeeId?: string };
};

export default async function PlansPage() {
  await requireAdminPanel();
  await connectDb();
  const plans = await RoutePlan.find().populate("assignedTo", "name employeeId").sort({ date: -1 }).limit(50).lean() as unknown as PlanDoc[];

  return <div className="space-y-5">
    <PageTitle title="Route plans" subtitle="Day plans built around doctor call timings"
      actions={<LinkButton href="/admin/plans/new"><Plus size={16} />New plan</LinkButton>} />

    {plans.length ? (
      <Card className="divide-y divide-[var(--line)]">
        {plans.map(plan => {
          const stops = plan.stops ?? [];
          const conflicts = stops.filter(stop => stop.withinCallTime === false).length;
          const when = plan.weekday !== undefined && plan.startTime
            ? `${WEEKDAYS[plan.weekday]} from ${toDisplayTime(plan.startTime)}`
            : "";
          // The delete control sits beside the link rather than inside it —
          // a button nested in an anchor is invalid and swallows the click.
          return <div key={String(plan._id)} className="flex items-start gap-2 px-5 py-4 hover:bg-[var(--surface-2)]">
            <Link href={`/admin/plans/${plan._id}`} className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{plan.name}</p>
              <p className="mt-0.5 text-xs text-[var(--muted)]">
                {formatDate(plan.date)}{when ? ` · ${when}` : ""}
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--ink-2)]">
                <span>{stops.length} stops</span>
                <span>{plan.totalDistanceKm ?? 0} km</span>
                <span>{plan.assignedTo?.name ?? "Not assigned"}</span>
                {conflicts > 0 && (
                  <span className="inline-flex items-center gap-1 font-medium text-amber-700">
                    <TriangleAlert size={12} />{conflicts} outside call time
                  </span>
                )}
              </p>
            </Link>
            <Badge tone={statusTone(plan.status)}>{plan.status}</Badge>
            <DeletePlanButton planId={String(plan._id)} planName={plan.name} />
          </div>;
        })}
      </Card>
    ) : (
      <EmptyState icon={CalendarRange} title="No route plans yet"
        description="Build a day's route from doctor call timings and assign it to a representative."
        action={<LinkButton href="/admin/plans/new"><Clock size={16} />Plan a route</LinkButton>} />
    )}
  </div>;
}
