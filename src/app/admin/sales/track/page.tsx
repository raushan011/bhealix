import { requireAdminPanel } from "@/lib/auth/guard";
import { PageTitle } from "@/components/ui/kit";
import { OrderTracker } from "@/components/sales-team/order-tracker";

/** Any order, found by name, phone, order number, AWB or date, and tracked — the team's and every Shiprocket order before them. */
export default async function SalesTrackPage() {
  await requireAdminPanel();
  return <div className="space-y-5">
    <PageTitle title="Track order" subtitle="Search sales orders and every Shiprocket order by name, phone, order number, AWB or date" />
    <OrderTracker basePath="/admin/sales/orders" />
  </div>;
}
