import { PageTitle } from "@/components/ui/kit";
import { DailyOrders } from "@/components/sales-team/daily-orders";

/** Who placed how many orders on which day — and every order of a day, a press away. */
export default function SalesTeamDailyPage() {
  return <div className="space-y-5">
    <PageTitle title="Daily orders" subtitle="Orders placed each day, by each executive, and from the shop and Shiprocket" />
    <DailyOrders orderPath="/admin/sales/orders" />
  </div>;
}
