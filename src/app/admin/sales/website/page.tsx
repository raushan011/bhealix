import { requireAdminPanel } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { PageTitle } from "@/components/ui/kit";
import { WebsiteCarts } from "@/components/sales-team/website-carts";

/** Shoppers who left their number at Add to cart on bhealix.com — to hand out, ring and follow. */
export default async function WebsiteCartsPage() {
  const session = await requireAdminPanel();
  return <div className="space-y-5">
    <PageTitle title="Website carts" subtitle="Shoppers who added to cart on bhealix.com. Hand each one to an executive, then follow every call and status here." />
    <WebsiteCarts mayAssign={can.manageSalesTeam(session.role)} />
  </div>;
}
