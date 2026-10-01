import { Suspense } from "react";
import Link from "next/link";
import { requireAdminPanel } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { PageTitle, Spinner } from "@/components/ui/kit";
import { LeadAssignment } from "@/components/sales-team/lead-assignment";

/** Handing the Leads CRM's leads to the sales executives who will ring them. */
export default async function SalesTeamLeadsPage() {
  const session = await requireAdminPanel();
  return <div className="space-y-5">
    <PageTitle title="Lead assignment" subtitle="Hand leads to an executive. They see only what is assigned to them, with every remark made so far." />
    <p className="text-sm text-[var(--muted)]">New leads are found and saved in the <Link href="/admin/leads" className="font-semibold text-[var(--brand)] hover:underline">Leads CRM</Link>.</p>
    <Suspense fallback={<Spinner />}><LeadAssignment mayAssign={can.manageSalesTeam(session.role)} /></Suspense>
  </div>;
}
