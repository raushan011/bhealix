import { Suspense } from "react";
import { Spinner } from "@/components/ui/kit";
import { OrderDetail } from "@/components/sales-team/order-detail";

export default async function ExecutiveOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense fallback={<Spinner />}><OrderDetail id={id} basePath="/executive/orders" /></Suspense>;
}
