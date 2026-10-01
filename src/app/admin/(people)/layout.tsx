import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { WORKSPACE_HOME } from "@/lib/workspace";

/**
 * HR & Employees, gathered behind one guard.
 *
 * Every employee lives here whichever CRM they work in — a medical
 * representative, a sales executive, the HR desk itself — because a salary, a
 * login and a leave balance are the same thing for all of them. These screens
 * used to sit inside the Doctor CRM, from when the field team was the only
 * team; the route group keeps every address they had (`/admin/hr`,
 * `/admin/team`) while giving them a door of their own.
 */
export default async function PeopleWorkspaceLayout({ children }: { children: React.ReactNode }) {
  const session = await requireWorkspace("people");
  if (!can.viewHr(session.role)) redirect(WORKSPACE_HOME.doctor);
  return <>{children}</>;
}
