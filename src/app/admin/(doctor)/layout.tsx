import { requireWorkspace } from "@/lib/auth/guard";

/**
 * The Doctor CRM, gathered behind one guard.
 *
 * The route group is what makes that possible: `(doctor)` is not part of any
 * URL, so every screen underneath keeps the address it has always had —
 * `/admin`, `/admin/billing`, `/admin/hr/payroll` — while gaining a layout that
 * the affiliate and super admin panels next door do not share. Without it the
 * only common ancestor is `/admin` itself, which cannot tell the three apart:
 * a layout is not told the path it is rendering.
 */
export default async function DoctorWorkspaceLayout({ children }: { children: React.ReactNode }) {
  await requireWorkspace("doctor");
  return <>{children}</>;
}
