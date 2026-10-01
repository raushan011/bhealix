import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdminPanel } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { Notice, PageTitle } from "@/components/ui/kit";
import { IncentiveRules } from "@/components/sales-team/incentive-rules";

/** What a COD, prepaid and part-paid order earns. The administrator's to set. */
export default async function SalesTeamSettingsPage() {
  const session = await requireAdminPanel();
  if (!can.manageSalesTeam(session.role)) redirect("/admin/sales");
  return <div className="space-y-5">
    <PageTitle title="Sales settings" subtitle="Where your executives' orders are placed, and what each way of paying earns them" />
    <IncentiveRules />
    <Notice>
      Orders go out through the company&rsquo;s one Shiprocket account, connected under{" "}
      <Link href="/admin/affiliate/settings" className="font-semibold underline">Affiliate CRM → Settings</Link>.
    </Notice>
  </div>;
}
