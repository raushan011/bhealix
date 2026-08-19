import Link from "next/link";
import { CalendarClock, ChevronLeft, ChevronRight, History, Navigation, Package, Phone, Repeat } from "lucide-react";
import { Types } from "mongoose";
import { requireFieldPanel } from "@/lib/auth/guard";
import { connectDb } from "@/lib/db/mongoose";
import { Visit } from "@/models/Visit";
import { Doctor } from "@/models/Doctor";
import { Badge, Card, EmptyState, PageTitle, Stat, statusTone } from "@/components/ui/kit";
import { doctorMapsUrl } from "@/lib/doctors/maps";
import { dayRange, formatDate, startOfDay, todayIso } from "@/lib/time";

export const dynamic = "force-dynamic";

type VisitDoc = {
  _id: unknown; plannedDate: Date; status: string; outcome?: string; interest?: string; notes?: string;
  followUpDate?: Date; orderValue?: number;
  checkInLocation?: { latitude?: number; longitude?: number };
  samples?: Array<{ product: string; quantity: number }>;
  doctor?: {
    _id: unknown; name?: string; clinicName?: string; area?: string; city?: string;
    fullAddress?: string; phones?: string[]; location?: { coordinates?: number[] };
  };
};

const PAGE = 25;
const STATUSES = ["Completed", "Missed"] as const;

/**
 * The rep's own past, cut the way they actually ask about it.
 *
 * "Which visits did I miss last month", "when was I last at Dr Sharma's",
 * "who did I promise a follow-up" — each is a filter, not a scroll. The
 * filters are a plain GET form, so the browser's back button and a shared
 * link both mean what they appear to mean, on a page that renders on the
 * server like the rest of the field panel.
 *
 * Every row carries the two buttons a rep reaches for standing on a road:
 * call, and open in Maps. The maps link falls back from the doctor's pin to
 * where the rep checked in to a plain address search — see lib/doctors/maps.
 */
export default async function HistoryPage({ searchParams }: {
  searchParams: Promise<{ status?: string; from?: string; to?: string; q?: string; page?: string }>;
}) {
  const session = await requireFieldPanel();
  const params = await searchParams;
  await connectDb();

  const status = STATUSES.includes(params.status as (typeof STATUSES)[number]) ? params.status : "";
  const range = dayRange(params.from, params.to);
  const q = (params.q ?? "").trim();
  const page = Math.max(1, Number(params.page) || 1);

  const where: Record<string, unknown> = {
    employee: new Types.ObjectId(session.userId),
    status: status || { $in: [...STATUSES] }
  };
  if (range) where.plannedDate = range;
  if (q) {
    // The rep types a doctor's name; visits store an id. Look the name up
    // first, and let an unknown name honestly match nothing.
    const match = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const doctors = await Doctor.find({ $or: [{ name: match }, { clinicName: match }, { area: match }] })
      .select("_id").limit(300).lean() as { _id: unknown }[];
    where.doctor = { $in: doctors.map(doctor => doctor._id) };
  }

  // The month as it is read here, not on whatever clock the server keeps.
  const monthStart = startOfDay(`${todayIso().slice(0, 7)}-01`);

  const [visits, total, completedThisMonth, samplesThisMonth] = await Promise.all([
    Visit.find(where)
      .populate("doctor", "name clinicName area city fullAddress phones location")
      .sort({ plannedDate: -1 }).skip((page - 1) * PAGE).limit(PAGE).lean() as unknown as Promise<VisitDoc[]>,
    Visit.countDocuments(where),
    Visit.countDocuments({ employee: session.userId, status: "Completed", plannedDate: { $gte: monthStart } }),
    Visit.aggregate<{ total: number }>([
      { $match: { employee: new Types.ObjectId(session.userId), status: "Completed", plannedDate: { $gte: monthStart } } },
      { $group: { _id: null, total: { $sum: { $sum: "$samples.quantity" } } } }
    ])
  ]);

  const pages = Math.max(1, Math.ceil(total / PAGE));
  const filtering = Boolean(status || range || q);

  /** The current filters as a query string, for the pager links. */
  const withPage = (nextPage: number) => {
    const search = new URLSearchParams();
    if (status) search.set("status", status);
    if (params.from) search.set("from", params.from);
    if (params.to) search.set("to", params.to);
    if (q) search.set("q", q);
    if (nextPage > 1) search.set("page", String(nextPage));
    const suffix = search.toString();
    return `/employee/history${suffix ? `?${suffix}` : ""}`;
  };

  return <div className="space-y-4">
    <PageTitle title="History" subtitle="Your completed and missed visits" />

    <Card className="grid grid-cols-2 gap-5 p-4">
      <Stat label="Completed this month" value={completedThisMonth} tone="text-[var(--ok-ink)]" />
      <Stat label="Samples given" value={samplesThisMonth[0]?.total ?? 0} />
    </Card>

    {/* A plain GET form: no client state to lose, and a filtered view is a link. */}
    <Card className="p-3.5">
      <form method="get" className="space-y-2.5">
        <input name="q" defaultValue={q} placeholder="Doctor, clinic or area" className="input" />
        <div className="grid grid-cols-2 gap-2">
          <select name="status" defaultValue={status} className="select" aria-label="Status">
            <option value="">Completed and missed</option>
            {STATUSES.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
          <button type="submit" className="tap rounded-[10px] bg-[var(--brand)] text-sm font-semibold text-[var(--on-brand)]">
            Apply
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input name="from" type="date" defaultValue={params.from ?? ""} className="input" aria-label="From day" />
          <input name="to" type="date" defaultValue={params.to ?? ""} className="input" aria-label="To day" />
        </div>
        {filtering && (
          <p className="flex items-center justify-between text-xs text-[var(--muted)]">
            <span><span className="font-semibold text-[var(--ink)]">{total}</span> visit{total === 1 ? "" : "s"} match</span>
            <Link href="/employee/history" className="font-semibold text-[var(--brand)]">Clear filters</Link>
          </p>
        )}
      </form>
    </Card>

    {visits.length ? (
      <div className="space-y-2">
        {visits.map(visit => {
          const doctor = visit.doctor;
          const maps = doctor ? doctorMapsUrl({
            coordinates: doctor.location?.coordinates,
            checkIn: visit.checkInLocation,
            name: doctor.name,
            clinicName: doctor.clinicName,
            fullAddress: doctor.fullAddress,
            area: doctor.area,
            city: doctor.city
          }) : doctorMapsUrl({ checkIn: visit.checkInLocation });
          const phone = doctor?.phones?.[0];

          return <Card key={String(visit._id)} className="p-3.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                {doctor ? (
                  <Link href={`/employee/doctors/${doctor._id}`} className="block truncate text-sm font-semibold">{doctor.name}</Link>
                ) : <p className="text-sm font-semibold">Doctor removed</p>}
                <p className="mt-0.5 text-xs text-[var(--muted)]">{formatDate(visit.plannedDate)}{doctor?.area ? ` · ${doctor.area}` : ""}</p>
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
            {visit.followUpDate && (
              <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-[var(--warn-ink)]">
                <CalendarClock size={12} />Follow up {formatDate(visit.followUpDate)}
              </p>
            )}
            {visit.notes && <p className="mt-1 text-xs italic text-[var(--muted)]">“{visit.notes}”</p>}

            {/* The row's verbs: back to the clinic, on the phone, or on paper. */}
            <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--line)] pt-2.5">
              {maps && (
                <a href={maps} target="_blank" rel="noreferrer"
                  className="tap inline-flex flex-1 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--line-2)] px-3 text-xs font-semibold">
                  <Navigation size={13} />Map
                </a>
              )}
              {phone && (
                <a href={`tel:${phone}`}
                  className="tap inline-flex flex-1 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--line-2)] px-3 text-xs font-semibold">
                  <Phone size={13} />Call
                </a>
              )}
              {doctor && (
                <Link href={`/employee/doctors/${doctor._id}`}
                  className="tap inline-flex flex-1 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--line-2)] px-3 text-xs font-semibold">
                  <Repeat size={13} />Visit again
                </Link>
              )}
              <Link href={`/employee/visits/${visit._id}`}
                className="tap inline-flex flex-1 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--line-2)] px-3 text-xs font-semibold">
                Details
              </Link>
            </div>
          </Card>;
        })}
      </div>
    ) : (
      <EmptyState icon={History} title={filtering ? "Nothing matches" : "No visits yet"}
        description={filtering ? "Loosen the filters — a different month, or fewer words." : "Completed visits will be listed here."} />
    )}

    {pages > 1 && (
      <div className="flex items-center justify-between text-sm">
        {page > 1
          ? <Link href={withPage(page - 1)} className="tap inline-flex items-center gap-1 rounded-[10px] border border-[var(--line-2)] px-4 font-semibold"><ChevronLeft size={15} />Newer</Link>
          : <span />}
        <span className="text-xs text-[var(--muted)]">Page {page} of {pages}</span>
        {page < pages
          ? <Link href={withPage(page + 1)} className="tap inline-flex items-center gap-1 rounded-[10px] border border-[var(--line-2)] px-4 font-semibold">Older<ChevronRight size={15} /></Link>
          : <span />}
      </div>
    )}
  </div>;
}
