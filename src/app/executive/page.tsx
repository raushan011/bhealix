import { Suspense } from "react";
import { PackagePlus, UserRoundSearch } from "lucide-react";
import { requireExecutivePanel } from "@/lib/auth/guard";
import { LinkButton, PageTitle, Spinner } from "@/components/ui/kit";
import { TeamOverview } from "@/components/sales-team/team-overview";

/** The executive's own figures: orders, deliveries, and what they have earned. */
export default async function ExecutiveDashboard() {
  const session = await requireExecutivePanel();
  return <div className="space-y-5">
    <PageTitle title={`Hello, ${session.name.split(" ")[0]}`} subtitle="Your leads, your orders and your incentive"
      actions={<>
        <LinkButton tone="secondary" href="/executive/leads"><UserRoundSearch size={16} />My leads</LinkButton>
        <LinkButton href="/executive/orders/new"><PackagePlus size={16} />New order</LinkButton>
      </>} />
    <Suspense fallback={<Spinner />}><TeamOverview admin={false} orderPath="/executive/orders" incentivePath="/executive/incentives" /></Suspense>
  </div>;
}
