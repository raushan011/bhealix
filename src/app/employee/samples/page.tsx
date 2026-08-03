import { Boxes } from "lucide-react";
import { requireFieldPanel } from "@/lib/auth/guard";
import { connectDb } from "@/lib/db/mongoose";
import { Card, EmptyState, Notice, PageTitle, Stat } from "@/components/ui/kit";
import { stockFor } from "@/lib/samples/ledger";

export const dynamic = "force-dynamic";

export default async function MySamplesPage() {
  const session = await requireFieldPanel();
  await connectDb();
  const rows = await stockFor(session.userId);

  const issued = rows.reduce((sum, row) => sum + row.issued, 0);
  const dispensed = rows.reduce((sum, row) => sum + row.dispensed, 0);
  const balance = rows.reduce((sum, row) => sum + row.balance, 0);
  const short = rows.filter(row => row.balance < 0);

  return <div className="space-y-4">
    <PageTitle title="My samples" subtitle="What you were given, and what you have handed over" />

    {!rows.length ? (
      <EmptyState icon={Boxes} title="No samples issued to you yet"
        description="Once your administrator issues you stock, it appears here and counts down as you record samples on your visits." />
    ) : <>
      <Card className="grid grid-cols-3 gap-4 p-4">
        <Stat label="Issued" value={issued} />
        <Stat label="Given out" value={dispensed} tone="text-emerald-700" />
        <Stat label="In hand" value={balance} tone={balance < 0 ? "text-rose-700" : undefined} />
      </Card>

      {short.length > 0 && (
        <Notice tone="error">
          Your count for {short.map(row => row.product).join(", ")} has gone below zero. Tell your administrator so the
          issue can be recorded — you do not need to change anything on your visits.
        </Notice>
      )}

      <Card className="divide-y divide-[var(--line)]">
        {rows.map(row => (
          <div key={row.product} className="px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <p className="min-w-0 flex-1 truncate text-sm font-semibold">{row.product}</p>
              <p className={`shrink-0 text-sm font-semibold ${row.balance < 0 ? "text-rose-700" : ""}`}>
                {row.balance} <span className="font-normal text-[var(--muted)]">in hand</span>
              </p>
            </div>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              {row.issued} issued · {row.dispensed} given to doctors
              {row.returned ? ` · ${row.returned} returned` : ""}
              {row.adjusted ? ` · ${row.adjusted > 0 ? "+" : ""}${row.adjusted} adjusted` : ""}
            </p>
          </div>
        ))}
      </Card>

      <p className="text-xs text-[var(--muted)]">
        Your count drops automatically when you complete a visit with samples recorded. Nothing else to fill in.
      </p>
    </>}
  </div>;
}
