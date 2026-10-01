import Link from "next/link";
import { Types } from "mongoose";
import { UserPlus, Users } from "lucide-react";
import { requireAdminPanel } from "@/lib/auth/guard";
import { connectDb } from "@/lib/db/mongoose";
import { can } from "@/constants/access";
import { SalesLead } from "@/models/Sales";
import { Badge, Card, EmptyState, LinkButton, PageTitle } from "@/components/ui/kit";
import { executiveSummaries } from "@/lib/sales-team/server";
import { formatRupees } from "@/lib/sales-team/orders";
import { formatDate } from "@/lib/time";

export const dynamic = "force-dynamic";

/**
 * The sales team, one row per executive, with their whole record so far.
 *
 * Their employment record, login and salary are kept under HR & Employees like
 * everybody else's — this screen links there rather than holding a second copy
 * of any of it.
 */
export default async function SalesExecutivesPage() {
  const session = await requireAdminPanel();
  await connectDb();

  const [rows, leads] = await Promise.all([
    executiveSummaries({}),
    SalesLead.aggregate([
      { $match: { assignedTo: { $ne: null } } },
      { $group: { _id: "$assignedTo", assigned: { $sum: 1 }, open: { $sum: { $cond: [{ $in: ["$status", ["Converted", "Not interested"]] }, 0, 1] } } } }
    ]) as Promise<Array<{ _id: Types.ObjectId; assigned: number; open: number }>>
  ]);
  const leadsOf = new Map(leads.map(row => [String(row._id), row]));
  const mayAdd = can.manageEmployees(session.role);

  return <div className="space-y-5">
    <PageTitle title="Executives" subtitle={`${rows.filter(row => row.executive.active).length} active sales executives`}
      actions={mayAdd ? <LinkButton href="/admin/team/new?role=EXECUTIVE"><UserPlus size={16} />Add a sales executive</LinkButton> : undefined} />

    {!rows.length ? (
      <EmptyState icon={Users} title="No sales executives yet"
        description="Add them under HR & Employees with the Sales executive role — with their login, salary and details in one form. They then sign in to their own panel."
        action={mayAdd ? <LinkButton href="/admin/team/new?role=EXECUTIVE">Add a sales executive</LinkButton> : undefined} />
    ) : (
      <Card className="divide-y divide-[var(--line)]">
        {rows.map(row => {
          const lead = leadsOf.get(row.executive._id);
          return <div key={row.executive._id} className="flex flex-wrap items-center gap-4 px-4 py-4 sm:px-5">
            <div className="min-w-0 flex-1 basis-full sm:basis-auto">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/admin/team/${row.executive._id}`} className="text-sm font-semibold hover:underline">{row.executive.name}</Link>
                {row.executive.employeeId && <span className="text-xs text-[var(--muted)]">{row.executive.employeeId}</span>}
                {!row.executive.active && <Badge tone="danger">Inactive</Badge>}
              </div>
              <p className="mt-0.5 text-xs text-[var(--muted)]">
                {lead ? `${lead.open} open lead${lead.open === 1 ? "" : "s"} of ${lead.assigned} assigned` : "No leads assigned"}
                {" · "}{row.orders} order{row.orders === 1 ? "" : "s"}, {row.delivered} delivered, {row.returned} returned
              </p>
            </div>
            <div className="text-right text-sm">
              <p className="font-semibold tabular-nums">{formatRupees(row.revenue)}</p>
              <p className="text-xs text-[var(--muted)]">revenue</p>
            </div>
            <div className="text-right text-sm">
              <p className="font-semibold tabular-nums">{formatRupees(row.incentive.payable)}</p>
              <p className="text-xs text-[var(--muted)]">owed · {formatRupees(row.incentive.paid)} paid</p>
            </div>
            <div className="flex gap-3 text-xs font-semibold">
              <Link href={`/admin/sales/orders?executive=${row.executive._id}`} className="text-[var(--brand)] hover:underline">Orders</Link>
              <Link href={`/admin/sales/incentives?executive=${row.executive._id}`} className="text-[var(--brand)] hover:underline">Incentives</Link>
              <Link href={`/admin/sales/leads?assigned=${row.executive._id}`} className="text-[var(--brand)] hover:underline">Leads</Link>
            </div>
          </div>;
        })}
      </Card>
    )}
    <p className="text-xs text-[var(--muted)]">Figures are for all time. The overview has them by date range. Last checked {formatDate(new Date())}.</p>
  </div>;
}
