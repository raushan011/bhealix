"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CakeSlice, CalendarCheck, CalendarDays, ClipboardCheck, PartyPopper, UserPlus, Users, Wallet
} from "lucide-react";
import { Badge, Card, EmptyState, LinkButton, Notice, PageTitle, Spinner, Stat } from "@/components/ui/kit";
import { ROLE_LABEL, type Role } from "@/constants/access";
import { formatDate, todayIso } from "@/lib/time";

type Person = { _id: string; name: string; employeeId: string; role?: Role; designation?: string; joiningDate?: string; dateOfBirth?: string };
type Overview = {
  today: string;
  headcount: { active: number; inactive: number; byRole: Record<string, number> };
  pendingLeave: number;
  onLeave: Array<{ _id: string; type: string; fromDate: string; toDate: string; halfDay?: string; employee?: Person | null }>;
  presentToday: number;
  absentToday: number;
  unmarked: number;
  holiday: string | null;
  joinedThisMonth: Person[];
  birthdays: Person[];
};

/**
 * The HR desk's own front page. Everything here answers a question somebody
 * will be asked before lunch: who is in, who is off, and what is waiting on a
 * decision.
 */
export default function HrDashboard() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/hr/overview").then(r => r.json())
      .then((json: { data?: Overview }) => { setData(json.data ?? null); setLoading(false); });
  }, []);

  if (loading) return <Spinner label="Loading the HR desk…" />;
  if (!data) return <Notice tone="error">The HR overview could not be loaded.</Notice>;

  const month = todayIso().slice(0, 7);

  return <div className="space-y-5">
    <PageTitle title="People" subtitle={formatDate(new Date())}
      actions={<>
        <LinkButton tone="secondary" href={`/admin/hr/attendance?month=${month}`}><CalendarCheck size={16} />Attendance</LinkButton>
        <LinkButton href="/admin/hr/leave"><ClipboardCheck size={16} />Leave requests</LinkButton>
      </>} />

    {data.holiday && (
      <Notice tone="success">
        <span className="inline-flex items-center gap-2"><PartyPopper size={15} />Today is a company holiday — {data.holiday}.</span>
      </Notice>
    )}

    <Card className="grid grid-cols-2 gap-5 p-5 sm:grid-cols-4">
      <Stat label="On the payroll" value={data.headcount.active} />
      <Stat label="In today" value={data.presentToday} tone="text-emerald-700" />
      <Stat label="On leave" value={data.onLeave.length} tone={data.onLeave.length ? "text-amber-700" : undefined} />
      <Stat label="Not yet marked" value={data.unmarked} tone={data.unmarked ? "text-[var(--muted)]" : undefined} />
    </Card>

    {data.pendingLeave > 0 && (
      <Notice tone="info">
        {data.pendingLeave} leave request{data.pendingLeave === 1 ? " is" : "s are"} waiting on a decision.{" "}
        <Link href="/admin/hr/leave?status=Pending" className="font-semibold underline underline-offset-2">Review them</Link>.
      </Notice>
    )}

    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
      {[
        { href: "/admin/team", label: "Employees", icon: Users },
        { href: `/admin/hr/attendance?month=${month}`, label: "Attendance", icon: CalendarCheck },
        { href: "/admin/hr/leave", label: "Leave", icon: ClipboardCheck },
        { href: "/admin/hr/holidays", label: "Holidays", icon: CalendarDays },
        { href: "/admin/hr/payroll", label: "Payroll", icon: Wallet }
      ].map(({ href, label, icon: Icon }) => (
        <Link key={href} href={href} className="card tap flex items-center gap-2.5 px-4 text-sm font-semibold hover:bg-[var(--surface-2)]">
          <Icon size={17} className="shrink-0 text-[var(--brand)]" />{label}
        </Link>
      ))}
    </div>

    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="overflow-hidden">
        <div className="border-b border-[var(--line)] px-5 py-3.5">
          <h2 className="text-sm font-semibold">Off today</h2>
        </div>
        {data.onLeave.length ? (
          <div className="divide-y divide-[var(--line)]">
            {data.onLeave.map(row => (
              <div key={row._id} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{row.employee?.name ?? "Someone"}</p>
                  <p className="truncate text-xs text-[var(--muted)]">
                    {row.type} leave · {formatDate(row.fromDate)}
                    {row.fromDate !== row.toDate ? ` – ${formatDate(row.toDate)}` : ""}
                    {row.halfDay ? ` · ${row.halfDay}` : ""}
                  </p>
                </div>
                {row.employee?.role && <Badge tone="info">{ROLE_LABEL[row.employee.role]}</Badge>}
              </div>
            ))}
          </div>
        ) : <p className="px-5 py-8 text-center text-sm text-[var(--muted)]">Everybody is in today.</p>}
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-[var(--line)] px-5 py-3.5">
          <h2 className="text-sm font-semibold">Headcount by role</h2>
        </div>
        <div className="divide-y divide-[var(--line)]">
          {(Object.keys(data.headcount.byRole) as Role[]).map(role => (
            <div key={role} className="flex items-center justify-between px-5 py-3 text-sm">
              <span>{ROLE_LABEL[role]}</span>
              <span className="font-semibold">{data.headcount.byRole[role]}</span>
            </div>
          ))}
          {data.headcount.inactive > 0 && (
            <div className="flex items-center justify-between px-5 py-3 text-sm text-[var(--muted)]">
              <span>Deactivated</span><span className="font-semibold">{data.headcount.inactive}</span>
            </div>
          )}
        </div>
      </Card>
    </div>

    {(data.birthdays.length > 0 || data.joinedThisMonth.length > 0) && (
      <div className="grid gap-4 lg:grid-cols-2">
        {data.birthdays.length > 0 && (
          <Card className="p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold"><CakeSlice size={15} className="text-[var(--brand)]" />Birthdays today</h2>
            <ul className="mt-2 space-y-1 text-sm">
              {data.birthdays.map(person => <li key={person._id}>{person.name} <span className="text-xs text-[var(--muted)]">({person.employeeId})</span></li>)}
            </ul>
          </Card>
        )}
        {data.joinedThisMonth.length > 0 && (
          <Card className="p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold"><UserPlus size={15} className="text-[var(--brand)]" />Joined this month</h2>
            <ul className="mt-2 space-y-1 text-sm">
              {data.joinedThisMonth.map(person => (
                <li key={person._id}>
                  {person.name}
                  <span className="text-xs text-[var(--muted)]">
                    {person.designation ? ` · ${person.designation}` : ""}{person.joiningDate ? ` · ${formatDate(person.joiningDate)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    )}

    {data.headcount.active === 0 && (
      <EmptyState icon={Users} title="Nobody on the payroll yet"
        description="Add your team to start tracking attendance, leave and employment records."
        action={<LinkButton href="/admin/team">Add an employee</LinkButton>} />
    )}
  </div>;
}
