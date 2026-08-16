import Link from "next/link";
import { CalendarRange, Clock, Pencil, Plus, TriangleAlert } from "lucide-react";
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
          // The link is stretched across the whole row so anywhere in it opens
          // the plan, while the delete button sits above it and keeps its click.
          // Nesting the button inside the anchor would be invalid markup.
          return <div key={String(plan._id)} className="relative flex items-start gap-2 px-5 py-4 hover:bg-[var(--surface-2)]">
            <Link href={`/admin/plans/${plan._id}`} aria-label={`Open ${plan.name}`} className="absolute inset-0" />
            <div className="pointer-events-none min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{plan.name}</p>
              <p className="mt-0.5 text-xs text-[var(--muted)]">
                {formatDate(plan.date)}{when ? ` · ${when}` : ""}
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--ink-2)]">
                <span>{stops.length} stops</span>
                <span>{plan.totalDistanceKm ?? 0} km</span>
                <span>{plan.assignedTo?.name ?? "Not assigned"}</span>
                {conflicts > 0 && (
                  <span className="inline-flex items-center gap-1 font-medium text-[var(--warn-ink)]">
                    <TriangleAlert size={12} />{conflicts} outside call time
                  </span>
                )}
              </p>
            </div>
            <div className="pointer-events-none relative"><Badge tone={statusTone(plan.status)}>{plan.status}</Badge></div>
            <Link href={`/admin/plans/new?from=${plan._id}`} aria-label={`Edit ${plan.name}`}
              className="relative grid size-9 shrink-0 place-items-center rounded-lg text-[var(--ink-2)] hover:bg-[var(--brand-soft)]">
              <Pencil size={15} />
            </Link>
            <div className="relative"><DeletePlanButton planId={String(plan._id)} planName={plan.name} /></div>
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
