import { redirect } from "next/navigation";
import { requireAdminPanel } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { PageTitle } from "@/components/ui/kit";
import { OrderEditor } from "@/components/sales-team/order-form";

export default async function EditSalesTeamOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminPanel();
  const { id } = await params;
  if (!can.placeSalesOrder(session.role)) redirect(`/admin/sales/orders/${id}`);
  return <div className="space-y-5">
    <PageTitle title="Edit order" subtitle="Possible until the order is booked with the courier" />
    <OrderEditor id={id} admin basePath="/admin/sales/orders" />
  </div>;
}
