import { Suspense } from "react";
import { PageTitle, Spinner } from "@/components/ui/kit";
import { IncentiveBoard } from "@/components/sales-team/incentive-board";

/** The executive's own incentive statement: on the way, owed, and paid. */
export default function ExecutiveIncentivesPage() {
  return <div className="space-y-5">
    <PageTitle title="My incentives" subtitle="Earned when your parcel is delivered. Paid by the office and recorded here." />
    <Suspense fallback={<Spinner />}><IncentiveBoard admin={false} orderPath="/executive/orders" /></Suspense>
  </div>;
}
