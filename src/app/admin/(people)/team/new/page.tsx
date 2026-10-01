import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireAdminPanel } from "@/lib/auth/guard";
import { ASSIGNABLE_ROLES, can, type Role } from "@/constants/access";
import { PageTitle } from "@/components/ui/kit";
import { EmployeeOnboarding } from "@/components/hr/employee-onboarding";

/** Adding an employee — login, record and salary in one go. */
export default async function NewEmployeePage({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  const session = await requireAdminPanel();
  if (!can.manageEmployees(session.role)) redirect("/admin/team");
  const { role } = await searchParams;
  const initialRole = (ASSIGNABLE_ROLES as readonly string[]).includes(role ?? "") ? role as Role : "EXECUTIVE";

  return <div className="space-y-5">
    <Link href="/admin/team" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--brand)]"><ArrowLeft size={16} />Employees</Link>
    <PageTitle title="Add an employee" subtitle="Their login, their employment record and their salary — everything HR keeps, in one place" />
    <EmployeeOnboarding initialRole={initialRole} mayAssignRoles={can.assignRoles(session.role)} mayRunPayroll={can.runPayroll(session.role)} />
  </div>;
}
