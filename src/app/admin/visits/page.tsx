import Link from "next/link";
import { ClipboardList, Package } from "lucide-react";
import { requireAdminPanel } from "@/lib/auth/guard";
import { connectDb } from "@/lib/db/mongoose";
import { Visit } from "@/models/Visit";
import { Badge, Card, EmptyState, PageTitle, statusTone } from "@/components/ui/kit";
import { formatDate, toDisplayTime } from "@/lib/time";

export const dynamic = "force-dynamic";

type VisitDoc = {
  _id: unknown; plannedDate: Date; plannedStart?: string; status: string; outcome?: string;
  interest?: string; notes?: string; orderValue?: number;
  samples?: Array<{ product: string; quantity: number }>; productsDiscussed?: string[];
  doctor?: { _id: unknown; name?: string; area?: string; city?: string };
  employee?: { name?: string };
};

export default async function VisitsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireAdminPanel();
  const status = (await searchParams).status;
  await connectDb();

  const filter = status ? { status } : {};
  const visits = await Visit.find(filter)
    .populate("doctor", "name area city")
    .populate("employee", "name")
    .sort({ plannedDate: -1, plannedStart: 1 }).limit(60).lean() as unknown as VisitDoc[];

  const tabs = [
    { label: "All", value: undefined },
    { label: "Completed", value: "Completed" },
    { label: "Planned", value: "Planned" },
    { label: "Missed", value: "Missed" }
  ];

  return <div className="space-y-5">
    <PageTitle title="Visits" subtitle="Every field visit, what was discussed and what was handed out" />

    <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
      {tabs.map(tab => {
        const active = status === tab.value || (!status && !tab.value);
        return <Link key={tab.label} href={tab.value ? `/admin/visits?status=${tab.value}` : "/admin/visits"}
          className={`min-h-[38px] shrink-0 rounded-full border px-4 text-xs font-semibold leading-[36px] ${
            active ? "border-[var(--brand)] bg-[var(--brand)] text-white" : "border-[var(--line-2)] bg-white text-[var(--ink-2)]"
          }`}>{tab.label}</Link>;
      })}
    </div>

    {visits.length ? (
      <Card className="divide-y divide-[var(--line)]">
        {visits.map(visit => (
          <div key={String(visit._id)} className="px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {visit.doctor ? (
                  <Link href={`/admin/doctors/${visit.doctor._id}`} className="truncate text-sm font-semibold hover:text-[var(--brand)]">
                    {visit.doctor.name}
                  </Link>
                ) : <p className="text-sm font-semibold">Doctor removed</p>}
                <p className="mt-0.5 text-xs text-[var(--muted)]">
                  {formatDate(visit.plannedDate)}
                  {visit.plannedStart ? ` · ${toDisplayTime(visit.plannedStart)}` : ""}
                  {visit.employee?.name ? ` · ${visit.employee.name}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Badge tone={statusTone(visit.status)}>{visit.status}</Badge>
                {visit.interest && <Badge tone={statusTone(visit.interest)}>{visit.interest}</Badge>}
              </div>
            </div>

            {visit.outcome && <p className="mt-2 text-sm text-[var(--ink-2)]">{visit.outcome}</p>}
            {Boolean(visit.productsDiscussed?.length) && (
              <p className="mt-1 text-xs text-[var(--muted)]">Discussed: {visit.productsDiscussed!.join(", ")}</p>
            )}
            {Boolean(visit.samples?.length) && (
              <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-[var(--brand)]">
                <Package size={12} />{visit.samples!.map(s => `${s.product} ×${s.quantity}`).join(", ")}
              </p>
            )}
            {visit.orderValue ? <p className="mt-1 text-xs font-semibold">Order ₹{visit.orderValue.toLocaleString("en-IN")}</p> : null}
            {visit.notes && <p className="mt-1 text-xs italic text-[var(--muted)]">“{visit.notes}”</p>}
          </div>
        ))}
      </Card>
    ) : (
      <EmptyState icon={ClipboardList} title="No visits here"
        description="Visits appear once a route plan is assigned to a representative." />
    )}
  </div>;
}
