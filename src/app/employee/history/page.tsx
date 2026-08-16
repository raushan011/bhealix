import Link from "next/link";
import { History, Package } from "lucide-react";
import { requireFieldPanel } from "@/lib/auth/guard";
import { connectDb } from "@/lib/db/mongoose";
import { Visit } from "@/models/Visit";
import { Badge, Card, EmptyState, PageTitle, Stat, statusTone } from "@/components/ui/kit";
import { formatDate, startOfDay, todayIso } from "@/lib/time";

export const dynamic = "force-dynamic";

type VisitDoc = {
  _id: unknown; plannedDate: Date; status: string; outcome?: string; interest?: string; notes?: string;
  samples?: Array<{ product: string; quantity: number }>; doctor?: { _id: unknown; name?: string; area?: string };
};

export default async function HistoryPage() {
  const session = await requireFieldPanel();
  await connectDb();

  // The month as it is read here, not on whatever clock the server keeps.
  const monthStart = startOfDay(`${todayIso().slice(0, 7)}-01`);

  const [visits, completedThisMonth, samplesThisMonth] = await Promise.all([
    Visit.find({ employee: session.userId, status: { $in: ["Completed", "Missed"] } })
      .populate("doctor", "name area").sort({ plannedDate: -1 }).limit(40).lean() as unknown as Promise<VisitDoc[]>,
    Visit.countDocuments({ employee: session.userId, status: "Completed", plannedDate: { $gte: monthStart } }),
    Visit.aggregate<{ total: number }>([
      { $match: { employee: session.userId, status: "Completed", plannedDate: { $gte: monthStart } } },
      { $group: { _id: null, total: { $sum: { $sum: "$samples.quantity" } } } }
    ])
  ]);

  return <div className="space-y-4">
    <PageTitle title="History" subtitle="Your completed and missed visits" />

    <Card className="grid grid-cols-2 gap-5 p-4">
      <Stat label="Completed this month" value={completedThisMonth} tone="text-[var(--ok-ink)]" />
      <Stat label="Samples given" value={samplesThisMonth[0]?.total ?? 0} />
    </Card>

    {visits.length ? (
      <div className="space-y-2">
        {visits.map(visit => (
          <Card key={String(visit._id)} className="p-3.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                {visit.doctor ? (
                  <Link href={`/employee/doctors/${visit.doctor._id}`} className="block truncate text-sm font-semibold">{visit.doctor.name}</Link>
                ) : <p className="text-sm font-semibold">Doctor removed</p>}
                <p className="mt-0.5 text-xs text-[var(--muted)]">{formatDate(visit.plannedDate)}{visit.doctor?.area ? ` · ${visit.doctor.area}` : ""}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Badge tone={statusTone(visit.status)}>{visit.status}</Badge>
                {visit.interest && <Badge tone={statusTone(visit.interest)}>{visit.interest}</Badge>}
              </div>
            </div>
            {visit.outcome && <p className="mt-2 text-sm text-[var(--ink-2)]">{visit.outcome}</p>}
            {Boolean(visit.samples?.length) && (
              <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-[var(--brand)]">
                <Package size={12} />{visit.samples!.map(s => `${s.product} ×${s.quantity}`).join(", ")}
              </p>
            )}
            {visit.notes && <p className="mt-1 text-xs italic text-[var(--muted)]">“{visit.notes}”</p>}
          </Card>
        ))}
      </div>
    ) : (
      <EmptyState icon={History} title="No visits yet" description="Completed visits will be listed here." />
    )}
  </div>;
}
