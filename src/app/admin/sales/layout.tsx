import { redirect } from "next/navigation";
import { requireAdminPanel } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { WORKSPACE_HOME } from "@/lib/workspace";

/**
 * The affiliate CRM's own door.
 *
 * The sidebar already hides what a role cannot use, but hiding a link is not a
 * permission (§4.8) — somebody typing the address, or following an old
 * bookmark, has to be turned away by the server. The routes underneath guard
 * themselves as well; this is what stops a screen rendering at all.
 */
export default async function SalesLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAdminPanel();
  if (!can.viewSales(session.role)) redirect(WORKSPACE_HOME.doctor);
  return <>{children}</>;
}
