import { Suspense } from "react";
import { PackagePlus } from "lucide-react";
import { requireAdminPanel } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { LinkButton, PageTitle, Spinner } from "@/components/ui/kit";
import { OrderTable } from "@/components/sales-team/order-table";

/** Every order the sales team has placed, with who placed it and what it earned. */
export default async function SalesTeamOrdersPage() {
  const session = await requireAdminPanel();
  return <div className="space-y-5">
    <PageTitle title="Orders" subtitle="Placed by your sales executives and shipped through Shiprocket"
      actions={can.placeSalesOrder(session.role) ? <LinkButton href="/admin/sales/orders/new"><PackagePlus size={16} />New order</LinkButton> : undefined} />
    <Suspense fallback={<Spinner />}><OrderTable basePath="/admin/sales/orders" showExecutive /></Suspense>
  </div>;
}
