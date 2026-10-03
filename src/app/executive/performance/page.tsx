import { Suspense } from "react";
import { PageTitle, Spinner } from "@/components/ui/kit";
import { TeamOverview } from "@/components/sales-team/team-overview";

/** The executive's own figures over a date range: orders, deliveries, returns and incentive. */
export default function ExecutivePerformancePage() {
  return <div className="space-y-5">
    <PageTitle title="My numbers" subtitle="Your orders, deliveries and incentive over time" />
    <Suspense fallback={<Spinner />}><TeamOverview admin={false} orderPath="/executive/orders" incentivePath="/executive/incentives" /></Suspense>
  </div>;
}
