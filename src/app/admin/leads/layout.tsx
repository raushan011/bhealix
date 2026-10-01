import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { CHOOSE_PATH } from "@/lib/workspace";

/**
 * The Leads CRM's door: prospecting, the retargeting list and automation.
 *
 * The permission is still `can.viewSales`, which is what these screens and their
 * routes have always been guarded by — the panel moved, the authority behind it
 * did not. The grant is asked first so somebody whose panel was withdrawn is sent
 * to one they still hold.
 */
export default async function LeadsLayout({ children }: { children: React.ReactNode }) {
  const session = await requireWorkspace("leads");
  if (!can.viewSales(session.role)) redirect(CHOOSE_PATH);
  return <>{children}</>;
}
