import { redirect } from "next/navigation";
import { requireAdminPanel } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { PageTitle } from "@/components/ui/kit";
import { OrderForm } from "@/components/sales-team/order-form";

/**
 * Placing an order on an executive's behalf — a sale closed at the office that
 * still belongs to the executive who found the customer.
 */
export default async function NewSalesTeamOrderPage({ searchParams }: { searchParams: Promise<{ lead?: string }> }) {
  const session = await requireAdminPanel();
  if (!can.placeSalesOrder(session.role)) redirect("/admin/sales/orders");
  const { lead } = await searchParams;
  return <div className="space-y-5">
    <PageTitle title="New order" subtitle="The order and its incentive belong to the executive you choose" />
    <OrderForm admin basePath="/admin/sales/orders" leadId={lead && /^[a-f\d]{24}$/i.test(lead) ? lead : undefined} />
  </div>;
}
