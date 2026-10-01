import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { CHOOSE_PATH } from "@/lib/workspace";

/**
 * The Sales CRM: the company's own sales executives, the orders they place and
 * the incentives those orders earn. The executives themselves work from
 * `/executive`; this is the desk's view over all of them.
 */
export default async function SalesTeamLayout({ children }: { children: React.ReactNode }) {
  const session = await requireWorkspace("sales");
  if (!can.viewSalesTeam(session.role)) redirect(CHOOSE_PATH);
  return <>{children}</>;
}
