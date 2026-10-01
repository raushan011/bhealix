import { Suspense } from "react";
import { Spinner } from "@/components/ui/kit";
import { OrderDetail } from "@/components/sales-team/order-detail";

export default async function SalesTeamOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense fallback={<Spinner />}><OrderDetail id={id} basePath="/admin/sales/orders" /></Suspense>;
}
