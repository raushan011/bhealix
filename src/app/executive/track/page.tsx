import { PageTitle } from "@/components/ui/kit";
import { OrderTracker } from "@/components/sales-team/order-tracker";

/** Any order, found by name, phone, order number or AWB, and tracked — your own and every older Shiprocket order. */
export default function ExecutiveTrackPage() {
  return <div className="space-y-5">
    <PageTitle title="Track order" subtitle="Search by customer name, phone, order number or AWB — including older Shiprocket orders" />
    <OrderTracker basePath="/executive/orders" />
  </div>;
}
