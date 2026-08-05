import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarRange, ClipboardList, Clock, MapPin, Search, Stethoscope, TriangleAlert, Users } from "lucide-react";
import { requireAdminPanel } from "@/lib/auth/guard";
import { connectDb } from "@/lib/db/mongoose";
import { Doctor } from "@/models/Doctor";
import { Visit } from "@/models/Visit";
import { RoutePlan } from "@/models/RoutePlan";
import { User } from "@/models/User";
import { Badge, Card, LinkButton, PageTitle, Stat, statusTone } from "@/components/ui/kit";
import { formatDate } from "@/lib/time";

export const dynamic = "force-dynamic";

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const endOfToday = () => { const d = new Date(); d.setHours(23, 59, 59, 999); return d; };

export default async function AdminDashboard() {
  const session = await requireAdminPanel();
  // This dashboard is about doctors, routes and visits — none of which are HR's
  // work. They get their own front page rather than one full of links they
  // cannot follow.
  if (session.role === "HR") redirect("/admin/hr");
  await connectDb();

  const [doctors, missingCallTime, missingLocation, team, todayVisits, todayDone, plans] = await Promise.all([
    Doctor.countDocuments({ status: "Active" }),
    Doctor.countDocuments({ status: "Active", callSchedule: { $size: 0 } }),
    Doctor.countDocuments({ status: "Active", "location.coordinates": { $exists: false } }),
    User.countDocuments({ active: true, role: { $in: ["MR", "SALES"] } }),
    Visit.countDocuments({ plannedDate: { $gte: startOfToday(), $lte: endOfToday() } }),
    Visit.countDocuments({ plannedDate: { $gte: startOfToday(), $lte: endOfToday() }, status: "Completed" }),
    RoutePlan.find({ date: { $gte: startOfToday() } }).populate("assignedTo", "name").sort({ date: 1 }).limit(5).lean()
  ]);

  const quickLinks = [
    { href: "/admin/discover", label: "Find doctors", icon: Search },
    { href: "/admin/doctors", label: "Directory", icon: Stethoscope },
    { href: "/admin/plans/new", label: "Plan a route", icon: CalendarRange },
    { href: "/admin/visits", label: "Visits", icon: ClipboardList }
  ];

  return <div className="space-y-5">
    <PageTitle
      title={`Welcome, ${session.name.split(" ")[0]}`}
      subtitle={formatDate(new Date())}
      actions={<LinkButton href="/admin/plans/new"><CalendarRange size={16} />Plan a route</LinkButton>}
    />

    <Card className="grid grid-cols-2 gap-5 p-5 sm:grid-cols-4">
      <Stat label="Active doctors" value={doctors} />
      <Stat label="Field team" value={team} />
      <Stat label="Visits today" value={todayVisits} />
      <Stat label="Completed today" value={todayDone} tone="text-emerald-700" />
    </Card>

    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
      {quickLinks.map(({ href, label, icon: Icon }) => (
        <Link key={href} href={href} className="card tap flex items-center gap-2.5 px-4 text-sm font-semibold hover:bg-[var(--surface-2)]">
          <Icon size={17} className="shrink-0 text-[var(--brand)]" />{label}
        </Link>
      ))}
    </div>

    {(missingCallTime > 0 || missingLocation > 0) && (
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <TriangleAlert size={18} className="mt-0.5 shrink-0 text-amber-600" />
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold">Data that blocks route planning</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Routes are built from call timings and map coordinates. Doctors missing either cannot be scheduled properly.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {missingCallTime > 0 && (
                <Link href="/admin/doctors?missingCallTime=1" className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800">
                  <Clock size={13} />{missingCallTime} without call time
                </Link>
              )}
              {missingLocation > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800">
                  <MapPin size={13} />{missingLocation} without coordinates
                </span>
              )}
            </div>
          </div>
        </div>
      </Card>
    )}

    <section>
      <div className="mb-2.5 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">Upcoming route plans</h2>
        <Link href="/admin/plans" className="text-sm font-semibold text-[var(--brand)]">View all</Link>
      </div>
      {plans.length ? (
        <Card className="divide-y divide-[var(--line)]">
          {plans.map(plan => {
            const record = plan as unknown as { _id: string; name: string; date: Date; status: string; stops: unknown[]; totalDistanceKm: number; assignedTo?: { name?: string } };
            return <Link key={String(record._id)} href={`/admin/plans/${record._id}`} className="flex items-center justify-between gap-3 px-5 py-4 hover:bg-[var(--surface-2)]">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{record.name}</p>
                <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
                  {formatDate(record.date)} · {record.stops.length} stops · {record.totalDistanceKm} km
                  {record.assignedTo?.name ? ` · ${record.assignedTo.name}` : " · unassigned"}
                </p>
              </div>
              <Badge tone={statusTone(record.status)}>{record.status}</Badge>
            </Link>;
          })}
        </Card>
      ) : (
        <Card className="px-5 py-10 text-center">
          <Users size={24} className="mx-auto text-[var(--line-2)]" />
          <p className="mt-2 text-sm text-[var(--muted)]">No upcoming plans. Build one to give your team their day.</p>
          <div className="mt-4 flex justify-center"><LinkButton tone="secondary" href="/admin/plans/new">Plan a route</LinkButton></div>
        </Card>
      )}
    </section>
  </div>;
}
