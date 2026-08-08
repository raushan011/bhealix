import { redirect } from "next/navigation";
import { BarChart3, Package } from "lucide-react";
import { requireAdminPanel } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { connectDb } from "@/lib/db/mongoose";
import { Visit } from "@/models/Visit";
import { Card, EmptyState, PageTitle, Stat } from "@/components/ui/kit";
import { formatDate } from "@/lib/time";
import { movementTotalsByEmployee } from "@/lib/samples/ledger";
import { utilisation } from "@/lib/samples/movements";

export const dynamic = "force-dynamic";

type Totals = { planned: number; completed: number; missed: number; orderValue: number };
type ByEmployee = { _id: unknown; name: string; employeeId: string; planned: number; completed: number; samples: number; orderValue: number };
type Sample = { product: string; quantity: number; doctorCount: number };
type Counted = { _id: string; count: number };

function Bar({ value, max }: { value: number; max: number }) {
  return <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--line)]">
    <div className="h-full rounded-full bg-[var(--brand)]" style={{ width: `${max ? Math.max(4, (value / max) * 100) : 0}%` }} />
  </div>;
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const session = await requireAdminPanel();
  // The whole field team's performance is the administrator's to read. The API
  // behind this already says so with `can.viewAllReports`; the page has to agree,
  // or typing the address walks straight past it.
  if (!can.viewAllReports(session.role)) redirect("/admin");
  const days = Math.min(180, Math.max(7, Number((await searchParams).days) || 30));
  await connectDb();

  const to = new Date(); to.setHours(23, 59, 59, 999);
  const from = new Date(Date.now() - (days - 1) * 86400000); from.setHours(0, 0, 0, 0);
  const range = { $gte: from, $lte: to };

  const [totalsRows, byEmployee, byOutcome, samples, byInterest, stockTotals] = await Promise.all([
    Visit.aggregate<Totals>([
      { $match: { plannedDate: range } },
      { $group: { _id: null,
        planned: { $sum: 1 },
        completed: { $sum: { $cond: [{ $eq: ["$status", "Completed"] }, 1, 0] } },
        missed: { $sum: { $cond: [{ $eq: ["$status", "Missed"] }, 1, 0] } },
        orderValue: { $sum: { $ifNull: ["$orderValue", 0] } } } }
    ]),
    Visit.aggregate<ByEmployee>([
      { $match: { plannedDate: range } },
      { $group: { _id: "$employee",
        planned: { $sum: 1 },
        completed: { $sum: { $cond: [{ $eq: ["$status", "Completed"] }, 1, 0] } },
        samples: { $sum: { $sum: "$samples.quantity" } },
        orderValue: { $sum: { $ifNull: ["$orderValue", 0] } } } },
      { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "employee" } },
      { $unwind: "$employee" },
      { $project: { name: "$employee.name", employeeId: "$employee.employeeId", planned: 1, completed: 1, samples: 1, orderValue: 1 } },
      { $sort: { completed: -1 } }
    ]),
    Visit.aggregate<Counted>([
      { $match: { plannedDate: range, status: "Completed", outcome: { $ne: null } } },
      { $group: { _id: "$outcome", count: { $sum: 1 } } }, { $sort: { count: -1 } }
    ]),
    Visit.aggregate<Sample>([
      { $match: { plannedDate: range, status: "Completed" } },
      { $unwind: "$samples" },
      { $group: { _id: "$samples.product", quantity: { $sum: "$samples.quantity" }, doctors: { $addToSet: "$doctor" } } },
      { $project: { _id: 0, product: "$_id", quantity: 1, doctorCount: { $size: "$doctors" } } },
      { $sort: { quantity: -1 } }
    ]),
    Visit.aggregate<Counted>([
      { $match: { plannedDate: range, status: "Completed", interest: { $ne: null } } },
      { $group: { _id: "$interest", count: { $sum: 1 } } }
    ]),
    movementTotalsByEmployee(range)
  ]);

  const totals = totalsRows[0] ?? { planned: 0, completed: 0, missed: 0, orderValue: 0 };
  const completion = totals.planned ? Math.round((totals.completed / totals.planned) * 100) : 0;
  const totalSamples = samples.reduce((sum, row) => sum + row.quantity, 0);
  const maxOutcome = Math.max(1, ...byOutcome.map(row => row.count));
  const maxSample = Math.max(1, ...samples.map(row => row.quantity));

  return <div className="space-y-5">
    <PageTitle title="Reports" subtitle={`${formatDate(from)} — ${formatDate(to)}`} />

    <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
      {[7, 30, 90].map(value => (
        <a key={value} href={`/admin/reports?days=${value}`}
          className={`min-h-[38px] shrink-0 rounded-full border px-4 text-xs font-semibold leading-[36px] ${
            days === value ? "border-[var(--brand)] bg-[var(--brand)] text-[var(--on-brand)]" : "border-[var(--line-2)] bg-[var(--surface)] text-[var(--ink-2)]"
          }`}>Last {value} days</a>
      ))}
    </div>

    <Card className="grid grid-cols-2 gap-5 p-5 sm:grid-cols-3 lg:grid-cols-5">
      <Stat label="Planned" value={totals.planned} />
      <Stat label="Completed" value={totals.completed} tone="text-[var(--ok-ink)]" />
      <Stat label="Missed" value={totals.missed} tone={totals.missed ? "text-[var(--danger-ink)]" : undefined} />
      <Stat label="Completion" value={`${completion}%`} />
      <Stat label="Samples given" value={totalSamples} />
    </Card>

    {!totals.planned ? (
      <EmptyState icon={BarChart3} title="Nothing to report yet"
        description="Once route plans are assigned and reps complete their visits, performance and sample distribution appear here." />
    ) : <>
      <Card className="overflow-hidden">
        <div className="border-b border-[var(--line)] px-5 py-3.5"><h2 className="text-[15px] font-semibold">By representative</h2></div>
        <div className="divide-y divide-[var(--line)]">
          {byEmployee.map(row => {
            const stock = stockTotals.get(String(row._id));
            const issued = stock?.issued ?? 0;
            const dispensed = stock?.dispensed ?? 0;
            /*
             * What moved in this period and has neither reached a doctor nor
             * come back. Adjustments count: a stocktake that wrote units off is
             * accounted for, not a shortfall to hold against the rep.
             *
             * Period, not lifetime — every figure here is filtered to the range
             * above, so stock issued before it is not in `issued`.
             */
            const unaccounted = issued - dispensed - (stock?.returned ?? 0) + (stock?.adjusted ?? 0);

            return <div key={String(row._id)} className="px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{row.name}</p>
                  <p className="text-xs text-[var(--muted)]">{row.employeeId}</p>
                </div>
                <div className="flex shrink-0 gap-5 text-right">
                  <div><p className="text-xs text-[var(--muted)]">Done</p><p className="text-sm font-semibold">{row.completed}/{row.planned}</p></div>
                  <div><p className="text-xs text-[var(--muted)]">Samples</p><p className="text-sm font-semibold">{row.samples}</p></div>
                </div>
              </div>
              <div className="mt-2"><Bar value={row.completed} max={row.planned} /></div>

              {issued > 0 && (
                <p className="mt-2 text-xs text-[var(--muted)]">
                  {issued} samples issued · {dispensed} reached doctors ({utilisation(issued, dispensed)}%)
                  {/* "In this period", not "in hand": everything here is
                      filtered to the range above, so stock issued before it is
                      not counted. The running balance lives on Samples. */}
                  {unaccounted !== 0 && (
                    <span className={unaccounted > 0 ? "" : "font-semibold text-[var(--danger-ink)]"}>
                      {" "}· {Math.abs(unaccounted)} {unaccounted > 0 ? "not yet handed over" : "over-recorded"} in this period
                    </span>
                  )}
                </p>
              )}
            </div>;
          })}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-[15px] font-semibold">Visit outcomes</h2>
          <div className="mt-3 space-y-3">
            {byOutcome.length ? byOutcome.map(row => (
              <div key={row._id}>
                <div className="flex justify-between text-sm"><span>{row._id}</span><span className="font-semibold">{row.count}</span></div>
                <div className="mt-1"><Bar value={row.count} max={maxOutcome} /></div>
              </div>
            )) : <p className="text-sm text-[var(--muted)]">No completed visits in this period.</p>}
          </div>

          {byInterest.length > 0 && <>
            <h3 className="mt-5 text-[13px] font-semibold text-[var(--ink-2)]">Doctor interest</h3>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {byInterest.map(row => (
                <span key={row._id} className="rounded-full bg-[var(--surface-2)] px-3 py-1.5 text-xs font-semibold">{row._id}: {row.count}</span>
              ))}
            </div>
          </>}
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-2">
            <Package size={16} className="text-[var(--brand)]" />
            <h2 className="text-[15px] font-semibold">Sample distribution</h2>
          </div>
          <div className="mt-3 space-y-3">
            {samples.length ? samples.map(row => (
              <div key={row.product}>
                <div className="flex justify-between text-sm">
                  <span className="truncate">{row.product}</span>
                  <span className="shrink-0 font-semibold">{row.quantity} <span className="font-normal text-[var(--muted)]">to {row.doctorCount} doctors</span></span>
                </div>
                <div className="mt-1"><Bar value={row.quantity} max={maxSample} /></div>
              </div>
            )) : <p className="text-sm text-[var(--muted)]">No samples recorded in this period.</p>}
          </div>
        </Card>
      </div>
    </>}
  </div>;
}
