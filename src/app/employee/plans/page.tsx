import Link from "next/link";
import { CalendarRange, ChevronRight, MapPin, Plus, Route } from "lucide-react";
import { requireFieldPanel } from "@/lib/auth/guard";
import { connectDb } from "@/lib/db/mongoose";
import { RoutePlan } from "@/models/RoutePlan";
import { Badge, EmptyState, LinkButton, PageTitle, statusTone } from "@/components/ui/kit";
import { formatDate, todayRange, toDisplayTime, WEEKDAYS } from "@/lib/time";

export const dynamic = "force-dynamic";

type PlanDoc = {
  _id: unknown; name: string; date: Date; weekday?: number; status: string; startTime?: string;
  totalDistanceKm?: number; stops?: unknown[];
};

function PlanRow({ plan }: { plan: PlanDoc }) {
  const when = plan.weekday !== undefined && plan.startTime
    ? `${WEEKDAYS[plan.weekday]} from ${toDisplayTime(plan.startTime)}`
    : "";
  return <Link href={`/employee/plans/${plan._id}`} className="card flex items-center gap-3 p-3.5 active:bg-[var(--surface-2)]">
    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]"><Route size={16} /></span>
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-semibold">{plan.name}</p>
      <p className="mt-0.5 truncate text-xs text-[var(--muted)]">{formatDate(plan.date)}{when ? ` · ${when}` : ""}</p>
      <p className="mt-0.5 flex items-center gap-1 text-xs text-[var(--brand)]">
        <MapPin size={11} />{plan.stops?.length ?? 0} stops · {plan.totalDistanceKm ?? 0} km
      </p>
    </div>
    <div className="flex shrink-0 items-center gap-2">
      <Badge tone={statusTone(plan.status)}>{plan.status}</Badge>
      <ChevronRight size={16} className="text-[var(--muted)]" />
    </div>
  </Link>;
}

function Group({ title, plans }: { title: string; plans: PlanDoc[] }) {
  if (!plans.length) return null;
  return <section>
    <h2 className="mb-2 text-[15px] font-semibold">{title}</h2>
    <div className="space-y-2">{plans.map(plan => <PlanRow key={String(plan._id)} plan={plan} />)}</div>
  </section>;
}

/**
 * Every plan the rep has been given, not just today's. The Today screen is
 * clamped to the current date, so without this a plan assigned for tomorrow was
 * invisible until the morning it started.
 */
export default async function MyPlansPage() {
  const session = await requireFieldPanel();
  await connectDb();

  // Today as the rep is living it, rather than as the server's clock has it.
  const { $gte: start, $lte: end } = todayRange();

  const plans = await RoutePlan.find({ assignedTo: session.userId })
    .select("name date weekday status startTime totalDistanceKm stops")
    .sort({ date: -1 }).limit(60).lean() as unknown as PlanDoc[];

  const today = plans.filter(plan => plan.date >= start && plan.date <= end);
  // Ascending, so the nearest day is the first thing the rep reads.
  const upcoming = plans.filter(plan => plan.date > end).reverse();
  const earlier = plans.filter(plan => plan.date < start);

  return <div className="space-y-5">
    <PageTitle title="My plans" subtitle="Routes assigned to you, and rounds you have planned yourself"
      actions={<LinkButton href="/employee/plans/new"><Plus size={16} />Plan a round</LinkButton>} />

    {plans.length ? <>
      <Group title="Today" plans={today} />
      <Group title="Coming up" plans={upcoming} />
      <Group title="Earlier" plans={earlier} />
    </> : (
      <EmptyState icon={CalendarRange} title="No plans yet"
        description="A route your administrator assigns appears here right away. You can also plan your own round — the order is worked out from each doctor's call time."
        action={<LinkButton href="/employee/plans/new">Plan a round</LinkButton>} />
    )}
  </div>;
}
