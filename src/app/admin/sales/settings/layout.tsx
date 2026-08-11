import { redirect } from "next/navigation";
import { requireAdminPanel } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { WORKSPACE_HOME } from "@/lib/workspace";

/**
 * Settings hold the Shopify token, the Shiprocket password and the commission
 * rates — the three things that decide what is read and what anybody is paid.
 * Reading the affiliate operation is one authority; changing what it pays is
 * another, and only the administrator has it.
 */
export default async function SalesSettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAdminPanel();
  if (!can.manageSales(session.role)) redirect(WORKSPACE_HOME.sales);
  return <>{children}</>;
}
