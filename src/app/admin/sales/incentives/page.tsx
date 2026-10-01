import { Suspense } from "react";
import { PageTitle, Spinner } from "@/components/ui/kit";
import { IncentiveBoard } from "@/components/sales-team/incentive-board";

/** What each executive is owed for delivered orders, and the desk that pays it. */
export default function SalesTeamIncentivesPage() {
  return <div className="space-y-5">
    <PageTitle title="Incentives" subtitle="Earned when a parcel is delivered, paid by hand and marked paid here" />
    <Suspense fallback={<Spinner />}><IncentiveBoard admin orderPath="/admin/sales/orders" /></Suspense>
  </div>;
}
