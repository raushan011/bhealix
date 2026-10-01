import { PageTitle } from "@/components/ui/kit";
import { OrderEditor } from "@/components/sales-team/order-form";

export default async function ExecutiveEditOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <div className="space-y-5">
    <PageTitle title="Edit order" subtitle="Possible until the order is booked with the courier" />
    <OrderEditor id={id} admin={false} basePath="/executive/orders" />
  </div>;
}
