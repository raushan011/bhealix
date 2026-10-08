import { Suspense } from "react";
import { PackagePlus, PackageSearch } from "lucide-react";
import { requireAdminPanel } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { LinkButton, PageTitle, Spinner } from "@/components/ui/kit";
import { OrderTable } from "@/components/sales-team/order-table";

/** Every order the sales team has placed, with who placed it and what it earned. */
export default async function SalesTeamOrdersPage() {
  const session = await requireAdminPanel();
  return <div className="space-y-5">
    <PageTitle title="Orders" subtitle="Every order since 1 September — placed by your sales executives, from the shop, and on Shiprocket"
      actions={<><LinkButton tone="secondary" href="/admin/sales/track"><PackageSearch size={16} />Track order</LinkButton>{can.placeSalesOrder(session.role) && <LinkButton href="/admin/sales/orders/new"><PackagePlus size={16} />New order</LinkButton>}</>} />
    <Suspense fallback={<Spinner />}><OrderTable basePath="/admin/sales/orders" showExecutive mayAssign={can.manageSalesTeam(session.role)} autoImport /></Suspense>
  </div>;
}
