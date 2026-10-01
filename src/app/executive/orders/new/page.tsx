import { PageTitle } from "@/components/ui/kit";
import { OrderForm } from "@/components/sales-team/order-form";

export default async function ExecutiveNewOrderPage({ searchParams }: { searchParams: Promise<{ lead?: string }> }) {
  const { lead } = await searchParams;
  return <div className="space-y-5">
    <PageTitle title="New order" subtitle="Check the address carefully — it is what the courier delivers to" />
    <OrderForm admin={false} basePath="/executive/orders" leadId={lead && /^[a-f\d]{24}$/i.test(lead) ? lead : undefined} />
  </div>;
}
