import { redirect } from "next/navigation";
import { requireAdminPanel } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { AutomationScreen } from "@/components/sales/automation-screen";

/**
 * The automation panel's door.
 *
 * `manageSales`, not `viewSales`: everything on this screen either holds a Meta
 * credential or decides that messages leave the company with nobody watching,
 * and neither is the viewing desk's to touch. The API routes underneath guard
 * themselves as well (§4.8) — this is what stops the screen rendering at all.
 */
export default async function SalesAutomationPage() {
  const session = await requireAdminPanel();
  if (!can.manageSales(session.role)) redirect("/admin/sales");
  return <AutomationScreen />;
}
