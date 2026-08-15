import { redirect } from "next/navigation";
import { requireAdminPanel } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { ProcessScreen } from "@/components/sales/process-screen";

/**
 * The processing screen's own door.
 *
 * Guarded here as well as in every route beneath it, because hiding a link is
 * not a permission (§4.8) and `processOrders` is a narrower authority than the
 * one that opens the affiliate CRM as a whole — it books freight at another
 * company's expense.
 */
export default async function ProcessOrdersPage() {
  const session = await requireAdminPanel();
  if (!can.processOrders(session.role)) redirect("/admin/sales/orders");
  return <ProcessScreen />;
}
