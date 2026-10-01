import Link from "next/link";
import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { Types } from "mongoose";
import { ArrowLeft, Camera, ClipboardList, History, MapPin, Package, Stethoscope } from "lucide-react";
import { requireAdminPanel } from "@/lib/auth/guard";
import { connectDb } from "@/lib/db/mongoose";
import { Visit } from "@/models/Visit";
import { VisitPhoto } from "@/models/VisitPhoto";
import { Doctor } from "@/models/Doctor";
import { User } from "@/models/User";
import { AuditEvent } from "@/models/Catalog";
import { Badge, Card, EmptyState, PageTitle, Stat, statusTone } from "@/components/ui/kit";
import { clockOf, formatDate, shiftDay, startOfDay, todayIso, toDisplayTime } from "@/lib/time";
import { auditLabel } from "@/lib/audit";
import { can, ROLE_LABEL, type Role } from "@/constants/access";
import { daysLeft, PHOTO_RETENTION_DAYS } from "@/lib/visits";
import { OBJECT_ID } from "@/lib/api";

export const dynamic = "force-dynamic";

/** How far back the page looks. `0` is everything on record. */
const RANGES = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "All time", days: 0 }
];

type Totals = {
  planned: number; completed: number; missed: number; pending: number;
  samples: number; orderValue: number;
};
type DoctorRow = {
  _id: unknown; name?: string; area?: string; city?: string; stage?: string;
  visits: number; completed: number; samples: number; orderValue: number;
  lastVisit: Date; lastOutcome?: string; lastInterest?: string; lastNotes?: string;
};
type VisitRow = {
  _id: unknown; plannedDate: Date; plannedStart?: string; status: string; outcome?: string;
  interest?: string; notes?: string; orderValue?: number; followUpDate?: Date;
  checkInAt?: Date; checkOutAt?: Date; checkInLocation?: { latitude?: number; longitude?: number };
  samples?: Array<{ product: string; quantity: number }>; productsDiscussed?: string[];
  doctor?: { _id: unknown; name?: string; area?: string; city?: string };
};
type PhotoRow = { _id: unknown; visit: unknown; expiresAt: Date };
type AuditRow = { _id: unknown; action: string; entityType?: string; entityId?: unknown; createdAt: Date; metadata?: Record<string, unknown> };

/**
 * Everything one representative has done in the field, on one screen.
 *
 * The employee profile next door answers "who is this person" — designation,
 * leave, bank details. This answers the other question an administrator has:
 * where have they been, who did they see, what did the doctor say, and what did
 * they change. Kept apart because they are read at different times and by
 * different people; HR has no business in a rep's call notes, so this screen is
 * the administrator's alone.
 */
export default async function FieldActivityPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ days?: string }>;
}) {
  const session = await requireAdminPanel();
  const { id } = await params;
  if (!OBJECT_ID.test(id)) notFound();
  // Reading somebody's whole field record is the administrator's, not HR's.
  if (!can.viewAllReports(session.role)) redirect(`/admin/team/${id}`);

  const requested = Number((await searchParams).days);
  const days = RANGES.some(range => range.days === requested) ? requested : 30;

  await connectDb();
  const employee = await User.findById(id)
    .select("name employeeId role designation department active phone email joiningDate").lean() as
    { _id: unknown; name: string; employeeId: string; role: Role; designation?: string;
      department?: string; active: boolean; phone?: string; joiningDate?: Date } | null;
  if (!employee) notFound();

  const owner = new Types.ObjectId(id);
  // Whole days as the field counts them, rather than as the server's clock does.
  const since = days ? startOfDay(shiftDay(todayIso(), -(days - 1))) : null;

  const visitFilter = { employee: owner, ...(since ? { plannedDate: { $gte: since } } : {}) };
  const sinceFilter = since ? { createdAt: { $gte: since } } : {};

  const [totalsRows, doctorsMet, doctorRows, visits, audits, doctorsOwned, doctorsAdded] = await Promise.all([
    Visit.aggregate<Totals>([
      { $match: visitFilter },
      { $group: { _id: null,
        planned: { $sum: 1 },
        completed: { $sum: { $cond: [{ $eq: ["$status", "Completed"] }, 1, 0] } },
        missed: { $sum: { $cond: [{ $eq: ["$status", "Missed"] }, 1, 0] } },
        pending: { $sum: { $cond: [{ $in: ["$status", ["Planned", "In progress"]] }, 1, 0] } },
        samples: { $sum: { $sum: "$samples.quantity" } },
        orderValue: { $sum: { $ifNull: ["$orderValue", 0] } } } }
    ]),
    // Distinct rather than an accumulator: a rep who saw the same doctor four
    // times has met one doctor, not four.
    Visit.distinct("doctor", { ...visitFilter, status: "Completed" }),
    Visit.aggregate<DoctorRow>([
      { $match: { ...visitFilter, status: { $in: ["Completed", "Missed"] } } },
      { $sort: { plannedDate: 1 } },
      { $group: { _id: "$doctor",
        visits: { $sum: 1 },
        completed: { $sum: { $cond: [{ $eq: ["$status", "Completed"] }, 1, 0] } },
        samples: { $sum: { $sum: "$samples.quantity" } },
        orderValue: { $sum: { $ifNull: ["$orderValue", 0] } },
        lastVisit: { $last: "$plannedDate" },
        lastOutcome: { $last: "$outcome" },
        lastInterest: { $last: "$interest" },
        lastNotes: { $last: "$notes" } } },
      { $lookup: { from: "doctors", localField: "_id", foreignField: "_id", as: "doctor" } },
      { $unwind: { path: "$doctor", preserveNullAndEmptyArrays: true } },
      { $addFields: { name: "$doctor.name", area: "$doctor.area", city: "$doctor.city", stage: "$doctor.stage" } },
      { $project: { doctor: 0 } },
      { $sort: { lastVisit: -1 } }
    ]),
    Visit.find(visitFilter).populate("doctor", "name area city")
      .sort({ plannedDate: -1, plannedStart: 1 }).limit(80).lean() as unknown as Promise<VisitRow[]>,
    AuditEvent.find({ actor: owner, ...sinceFilter }).sort({ createdAt: -1 }).limit(80).lean() as unknown as Promise<AuditRow[]>,
    Doctor.countDocuments({ assignedTo: owner }),
    AuditEvent.countDocuments({ actor: owner, action: "doctor.created", ...sinceFilter })
  ]);

  // Photos come after the visits, because only the visits on screen need them.
  const photos = await VisitPhoto.find({
    visit: { $in: visits.map(visit => visit._id) }, expiresAt: { $gt: new Date() }
  }).select("visit expiresAt").sort({ createdAt: 1 }).lean() as unknown as PhotoRow[];

  const photosByVisit = new Map<string, PhotoRow[]>();
  for (const photo of photos) {
    const key = String(photo.visit);
    photosByVisit.set(key, [...(photosByVisit.get(key) ?? []), photo]);
  }

  const totals = totalsRows[0] ?? { planned: 0, completed: 0, missed: 0, pending: 0, samples: 0, orderValue: 0 };
  const rate = totals.planned ? Math.round((totals.completed / totals.planned) * 100) : 0;
  const period = days ? `Last ${days} days` : "Everything on record";

  return <div className="space-y-5">
    <Link href={`/admin/team/${id}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--brand)]">
      <ArrowLeft size={16} />{employee.name}
    </Link>

    <PageTitle title={`${employee.name} in the field`}
      subtitle={[ROLE_LABEL[employee.role], employee.employeeId, employee.designation, period].filter(Boolean).join(" · ")}
      actions={<Link href={`/admin/team/${id}`}
        className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-[10px] border border-[var(--line-2)] bg-[var(--surface)] px-4 text-sm font-semibold">
        Employment record
      </Link>} />

    <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
      {RANGES.map(range => {
        const active = range.days === days;
        return <Link key={range.label} href={`/admin/team/${id}/activity?days=${range.days}`}
          className={`min-h-[38px] shrink-0 rounded-full border px-4 text-xs font-semibold leading-[36px] ${
            active ? "border-[var(--brand)] bg-[var(--brand)] text-[var(--on-brand)]" : "border-[var(--line-2)] bg-[var(--surface)] text-[var(--ink-2)]"
          }`}>{range.label}</Link>;
      })}
    </div>

    {/* Seven across is only honest on a wide desktop — one of these is an order
        value in rupees, and a 100px column cannot hold one. */}
    <Card className="grid grid-cols-2 gap-5 p-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
      <Stat label="Doctors met" value={doctorsMet.length} />
      <Stat label="Visits completed" value={totals.completed} />
      <Stat label="Missed" value={totals.missed} tone={totals.missed ? "text-[var(--danger-ink)]" : undefined} />
      <Stat label="Still to do" value={totals.pending} />
      <Stat label="Completion" value={`${rate}%`} />
      <Stat label="Samples given" value={totals.samples} />
      <Stat label="Order value" value={`₹${totals.orderValue.toLocaleString("en-IN")}`} />
    </Card>

    <Card className="flex flex-wrap gap-x-8 gap-y-3 p-5 text-sm">
      <p className="text-[var(--muted)]">Doctors in their list <span className="ml-1 font-semibold text-[var(--ink)]">{doctorsOwned}</span></p>
      <p className="text-[var(--muted)]">Doctors they added <span className="ml-1 font-semibold text-[var(--ink)]">{doctorsAdded}</span></p>
      <p className="text-[var(--muted)]">Photos attached <span className="ml-1 font-semibold text-[var(--ink)]">{photos.length}</span></p>
      {!employee.active && <Badge tone="danger">Account deactivated</Badge>}
    </Card>

    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-[var(--line)] px-5 py-3.5">
        <Stethoscope size={15} className="text-[var(--brand)]" />
        <h2 className="text-sm font-semibold">Doctors visited</h2>
        <span className="text-xs text-[var(--muted)]">{doctorRows.length} in this period</span>
      </div>
      {doctorRows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-[var(--surface-2)] text-left text-xs text-[var(--muted)]">
              <tr>
                <th className="px-5 py-2.5 font-medium">Doctor</th>
                <th className="px-5 py-2.5 font-medium">Visits</th>
                <th className="px-5 py-2.5 font-medium">Last seen</th>
                <th className="px-5 py-2.5 font-medium">Last outcome</th>
                <th className="px-5 py-2.5 font-medium">Interest</th>
                <th className="px-5 py-2.5 text-right font-medium">Samples</th>
                <th className="px-5 py-2.5 text-right font-medium">Orders</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {doctorRows.map(row => (
                <tr key={String(row._id)}>
                  <td className="px-5 py-3">
                    {row.name ? (
                      <Link href={`/admin/doctors/${row._id}`} className="font-medium hover:text-[var(--brand)]">{row.name}</Link>
                    ) : <span className="text-[var(--muted)]">Doctor removed</span>}
                    <p className="text-xs text-[var(--muted)]">{[row.area, row.city].filter(Boolean).join(" · ") || "—"}</p>
                  </td>
                  <td className="px-5 py-3">
                    {row.completed}
                    {row.visits > row.completed && <span className="text-[var(--muted)]"> of {row.visits}</span>}
                  </td>
                  <td className="px-5 py-3 whitespace-nowrap">{formatDate(row.lastVisit)}</td>
                  <td className="px-5 py-3">{row.lastOutcome ?? "—"}</td>
                  <td className="px-5 py-3">{row.lastInterest ? <Badge tone={statusTone(row.lastInterest)}>{row.lastInterest}</Badge> : "—"}</td>
                  <td className="px-5 py-3 text-right">{row.samples || "—"}</td>
                  <td className="px-5 py-3 text-right">{row.orderValue ? `₹${row.orderValue.toLocaleString("en-IN")}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="px-5 py-8 text-center text-sm text-[var(--muted)]">No completed or missed visits in this period.</p>}
    </Card>

    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-[var(--line)] px-5 py-3.5">
        <ClipboardList size={15} className="text-[var(--brand)]" />
        <h2 className="text-sm font-semibold">Every visit, with the remarks</h2>
        {visits.length === 80 && <span className="text-xs text-[var(--muted)]">most recent 80</span>}
      </div>
      {visits.length ? (
        <div className="divide-y divide-[var(--line)]">
          {visits.map(visit => {
            const attached = photosByVisit.get(String(visit._id)) ?? [];
            return <div key={String(visit._id)} className="px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  {visit.doctor ? (
                    <Link href={`/admin/doctors/${visit.doctor._id}`} className="text-sm font-semibold hover:text-[var(--brand)]">
                      {visit.doctor.name}
                    </Link>
                  ) : <p className="text-sm font-semibold">Doctor removed</p>}
                  <p className="mt-0.5 text-xs text-[var(--muted)]">
                    {formatDate(visit.plannedDate)}
                    {visit.plannedStart ? ` · planned ${toDisplayTime(visit.plannedStart)}` : ""}
                    {visit.checkInAt ? ` · checked in ${toDisplayTime(clockOf(visit.checkInAt))}` : ""}
                    {[visit.doctor?.area, visit.doctor?.city].filter(Boolean).length ? ` · ${[visit.doctor?.area, visit.doctor?.city].filter(Boolean).join(", ")}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {visit.interest && <Badge tone={statusTone(visit.interest)}>{visit.interest}</Badge>}
                  <Badge tone={statusTone(visit.status)}>{visit.status}</Badge>
                </div>
              </div>

              {visit.outcome && <p className="mt-2 text-sm text-[var(--ink-2)]">{visit.outcome}</p>}
              {Boolean(visit.productsDiscussed?.length) && (
                <p className="mt-1 text-xs text-[var(--muted)]">Discussed: {visit.productsDiscussed!.join(", ")}</p>
              )}
              {Boolean(visit.samples?.length) && (
                <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-[var(--brand)]">
                  <Package size={12} />{visit.samples!.map(sample => `${sample.product} ×${sample.quantity}`).join(", ")}
                </p>
              )}
              {visit.orderValue ? <p className="mt-1 text-xs font-semibold">Order ₹{visit.orderValue.toLocaleString("en-IN")}</p> : null}
              {visit.notes && <p className="mt-1.5 text-sm italic text-[var(--ink-2)]">“{visit.notes}”</p>}

              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--muted)]">
                {visit.followUpDate && <span>Follow up {formatDate(visit.followUpDate)}</span>}
                {visit.checkInLocation?.latitude !== undefined && visit.checkInLocation.longitude !== undefined && (
                  <a href={`https://www.google.com/maps?q=${visit.checkInLocation.latitude},${visit.checkInLocation.longitude}`}
                    target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-[var(--brand)]">
                    <MapPin size={12} />Where they checked in
                  </a>
                )}
              </div>

              {attached.length > 0 && (
                <div className="mt-3">
                  <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-[var(--ink-2)]">
                    <Camera size={12} />{attached.length} photo{attached.length === 1 ? "" : "s"}
                    <span className="font-normal text-[var(--muted)]">· oldest goes in {daysLeft(attached[0].expiresAt)} days</span>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {attached.map(photo => (
                      <a key={String(photo._id)} href={`/api/visits/${visit._id}/photos/${photo._id}`}
                        target="_blank" rel="noreferrer"
                        className="relative size-20 overflow-hidden rounded-[10px] border border-[var(--line-2)] bg-[var(--surface-2)]">
                        {/* Unoptimized on purpose: these bytes are private and
                            expire, and must not be copied into an image cache
                            with a lifetime of its own. */}
                        <Image src={`/api/visits/${visit._id}/photos/${photo._id}`} alt={`Photo from the visit on ${formatDate(visit.plannedDate)}`}
                          fill unoptimized sizes="80px" className="object-cover" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>;
          })}
        </div>
      ) : (
        <p className="px-5 py-8 text-center text-sm text-[var(--muted)]">No visits in this period.</p>
      )}
    </Card>

    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-[var(--line)] px-5 py-3.5">
        <History size={15} className="text-[var(--brand)]" />
        <h2 className="text-sm font-semibold">What they changed</h2>
        <span className="text-xs text-[var(--muted)]">doctors added, call times corrected, visits closed</span>
      </div>
      {audits.length ? (
        <ol className="divide-y divide-[var(--line)]">
          {audits.map(event => (
            <li key={String(event._id)} className="flex items-baseline gap-3 px-5 py-2.5 text-sm">
              <span className="w-36 shrink-0 text-xs text-[var(--muted)]">
                {new Date(event.createdAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
              </span>
              <span className="font-medium">{auditLabel(event.action)}</span>
              <span className="min-w-0 truncate text-[var(--muted)]">{describe(event)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="px-5 py-8 text-center text-sm text-[var(--muted)]">Nothing recorded in this period.</p>
      )}
    </Card>

    {!visits.length && !audits.length && (
      <EmptyState icon={ClipboardList} title="Nothing in this period"
        description="Widen the range above, or assign this representative a route plan." />
    )}

    <p className="text-xs text-[var(--muted)]">
      Visit photographs are removed automatically {PHOTO_RETENTION_DAYS} days after they are taken, so an older visit
      shows its remarks without them.
    </p>
  </div>;
}

/** The one detail worth reading beside each line of the trail. */
function describe(event: AuditRow) {
  const meta = event.metadata ?? {};
  const name = typeof meta.name === "string" ? meta.name : "";
  switch (event.action) {
    case "doctor.created": return [name, meta.city].filter(Boolean).join(" · ");
    case "doctor.call-schedule.updated": return name;
    case "visit.completed":
    case "visit.edited": {
      const parts = [meta.outcome, meta.interest].filter(Boolean) as string[];
      if (meta.samples) parts.push(`${meta.samples} samples`);
      if (meta.orderValue) parts.push(`₹${Number(meta.orderValue).toLocaleString("en-IN")}`);
      return parts.join(" · ");
    }
    case "visit.missed": return typeof meta.notes === "string" ? meta.notes : "";
    case "visit.checked-in": return meta.located ? "with location" : "without location";
    case "visit.photo.added": return `${meta.count ?? 1} photo${meta.count === 1 ? "" : "s"}`;
    default: return "";
  }
}
