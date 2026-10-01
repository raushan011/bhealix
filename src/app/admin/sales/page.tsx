import { Suspense } from "react";
import { PackagePlus, UserPlus } from "lucide-react";
import { requireAdminPanel } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { LinkButton, PageTitle, Spinner } from "@/components/ui/kit";
import { TeamOverview } from "@/components/sales-team/team-overview";

/** The Sales CRM's front page: how the sales team is doing, executive by executive. */
export default async function SalesTeamOverviewPage() {
  const session = await requireAdminPanel();
  return <div className="space-y-5">
    <PageTitle title="Sales CRM" subtitle="Your sales executives — the leads they were given, the orders they placed and shipped, and the incentive each earned"
      actions={<>
        {can.manageSalesTeam(session.role) && <LinkButton tone="secondary" href="/admin/sales/leads"><UserPlus size={16} />Assign leads</LinkButton>}
        {can.placeSalesOrder(session.role) && <LinkButton href="/admin/sales/orders/new"><PackagePlus size={16} />New order</LinkButton>}
      </>} />
    <Suspense fallback={<Spinner />}><TeamOverview admin orderPath="/admin/sales/orders" incentivePath="/admin/sales/incentives" /></Suspense>
  </div>;
}
