import { Suspense } from "react";
import { PackagePlus } from "lucide-react";
import { LinkButton, PageTitle, Spinner } from "@/components/ui/kit";
import { OrderTable } from "@/components/sales-team/order-table";

export default function ExecutiveOrdersPage() {
  return <div className="space-y-5">
    <PageTitle title="My orders" subtitle="Every order you have placed, where it is, and what it earns you"
      actions={<LinkButton href="/executive/orders/new"><PackagePlus size={16} />New order</LinkButton>} />
    <Suspense fallback={<Spinner />}><OrderTable basePath="/executive/orders" showExecutive={false} /></Suspense>
  </div>;
}
