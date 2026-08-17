import Link from "next/link";
import Image from "next/image";
import { Camera, ClipboardList, MapPin, Package } from "lucide-react";
import { requireAdminPanel } from "@/lib/auth/guard";
import { connectDb } from "@/lib/db/mongoose";
import { Visit } from "@/models/Visit";
import { VisitPhoto } from "@/models/VisitPhoto";
import { Badge, Card, EmptyState, PageTitle, statusTone } from "@/components/ui/kit";
import { clockOf, dayRange, formatDate, shiftDay, todayIso, toDisplayTime } from "@/lib/time";
import { daysLeft } from "@/lib/visits";
import { placeLabel } from "@/lib/geo";
import type { PhotoLocation } from "@/components/visits/visit-photos";
import { SAMPLE_ANY, SAMPLE_NONE, VisitDateFilter } from "@/components/visits/visit-date-filter";

export const dynamic = "force-dynamic";

/** The named places a visit's photos were taken, each said once. */
const placesOf = (photos: PhotoDoc[]) => [...new Set(photos
  .filter(photo => typeof photo.location?.latitude === "number")
  .map(photo => placeLabel(photo.location!, photo.location!)))];

type VisitDoc = {
  _id: unknown; plannedDate: Date; plannedStart?: string; checkInAt?: Date; status: string; outcome?: string;
  interest?: string; notes?: string; orderValue?: number; routePlan?: unknown;
  samples?: Array<{ product: string; quantity: number }>; productsDiscussed?: string[];
  doctor?: { _id: unknown; name?: string; area?: string; city?: string };
  employee?: { name?: string };
};
type PhotoDoc = { _id: unknown; visit: unknown; expiresAt: Date; location?: PhotoLocation };

/**
 * When a visit happened, as the field would tell it.
 *
 * A visit that was started carries the moment it was checked in, which is the
 * one worth reading; only a call still lying ahead has nothing but the time its
 * route plan intended. Reading the stamp rather than the stored clock also puts
 * right the visits registered before this page knew which zone it was in.
 */
const timeOf = (visit: VisitDoc) => visit.checkInAt ? clockOf(visit.checkInAt) : visit.plannedStart;

/**
 * The sample choice as a condition on the visit.
 *
 * "Any" and "none" are the two questions stock actually asks — who is handing
 * samples out at all, and which calls went empty-handed — so they are offered
 * beside the products rather than left to be worked out from a full list.
 * Anything unrecognised filters nothing, the same as a mangled date.
 */
function sampleFilter(sample?: string) {
  if (sample === SAMPLE_ANY) return { "samples.0": { $exists: true } };
  if (sample === SAMPLE_NONE) return { "samples.0": { $exists: false } };
  return sample ? { "samples.product": sample } : {};
}

/**
 * Whether a visit that has happened handed anything over.
 *
 * Said on every completed call, not only the ones that gave something out: a
 * card with no sample line reads as "nobody filled this in", and the difference
 * between that and "the rep gave nothing" is the whole question. A visit still
 * ahead of the rep is left alone, having nothing to report yet.
 */
const SETTLED = ["Completed", "Missed"];

export default async function VisitsPage({ searchParams }: {
  searchParams: Promise<{ status?: string; from?: string; to?: string; sample?: string }>;
}) {
  await requireAdminPanel();
  const { status, from, to, sample } = await searchParams;
  await connectDb();

  // Everything a rep has ever handed over — taken from the visits rather than
  // the catalogue, because a product since retired is still in this log and a
  // name the dropdown cannot offer is a question nobody can ask.
  const products = ((await Visit.distinct("samples.product")) as string[]).filter(Boolean).sort();

  // An unrecognised choice filters nothing, the same as a mangled date: it
  // arrives from the address bar, and a silently empty list is a worse answer
  // than the whole log.
  const sampleChoice = sample === SAMPLE_ANY || sample === SAMPLE_NONE || (sample && products.includes(sample))
    ? sample : "";

  const range = dayRange(from, to);
  const filter = {
    ...(status ? { status } : {}),
    ...(range ? { plannedDate: range } : {}),
    ...sampleFilter(sampleChoice)
  };

  // Sixty is enough of an open-ended feed to be worth reading. A chosen span is
  // a question with an answer, though, and cutting a day's work off at sixty
  // would be a wrong one, so the ceiling lifts once the filters are set.
  const ceiling = range || sampleChoice ? 300 : 60;
  const visits = await Visit.find(filter)
    .populate("doctor", "name area city")
    .populate("employee", "name")
    .sort({ plannedDate: -1, plannedStart: 1 }).limit(ceiling).lean() as unknown as VisitDoc[];

  // Metadata for the visits on screen only, and nothing already past its thirty
  // days. The bytes are fetched by the browser one image at a time.
  const photos = await VisitPhoto.find({
    visit: { $in: visits.map(visit => visit._id) }, expiresAt: { $gt: new Date() }
  }).select("visit expiresAt location").sort({ createdAt: 1 }).lean() as unknown as PhotoDoc[];

  const photosByVisit = new Map<string, PhotoDoc[]>();
  for (const photo of photos) {
    const key = String(photo.visit);
    photosByVisit.set(key, [...(photosByVisit.get(key) ?? []), photo]);
  }

  const tabs = [
    { label: "All", value: undefined },
    { label: "Completed", value: "Completed" },
    { label: "Planned", value: "Planned" },
    { label: "Missed", value: "Missed" }
  ];

  // Worked out here rather than in the browser: the day a rep is having is the
  // one this page must agree with, whatever clock the reader's laptop keeps.
  const today = todayIso();
  const yesterday = shiftDay(today, -1);
  const presets = [
    { label: "Today", from: today, to: today },
    { label: "Yesterday", from: yesterday, to: yesterday },
    { label: "Last 7 days", from: shiftDay(today, -6), to: today },
    { label: "This month", from: `${today.slice(0, 7)}-01`, to: today }
  ];

  // Only the ends the range actually took, so a mangled address bar is neither
  // read back to the reader nor carried across to the next tab.
  const fromDay = range?.$gte ? from! : "";
  const toDay = range?.$lte ? to! : "";
  const chosenDays = !range ? ""
    : fromDay === toDay ? formatDate(fromDay)
    : fromDay && toDay ? `${formatDate(fromDay)} – ${formatDate(toDay)}`
    : fromDay ? `since ${formatDate(fromDay)}`
    : `up to ${formatDate(toDay)}`;

  const chosenSample = sampleChoice === SAMPLE_ANY ? "a sample given"
    : sampleChoice === SAMPLE_NONE ? "no sample given"
    : sampleChoice ? `${sampleChoice} given` : "";
  const chosen = [chosenDays, chosenSample].filter(Boolean).join(" · ");

  return <div className="space-y-5">
    <PageTitle title="Visits" subtitle="Every field visit, what was discussed and what was handed out" />

    {/*
      * The log and the day view are two questions, not two filters.
      *
      * This screen is a feed: every call ever recorded, newest first, narrowed
      * by status, day and sample — which answers "what happened at Dr Mehta's
      * in June". It cannot answer the one a desk asks at four in the afternoon,
      * because that needs one day grouped by the person walking it, in the
      * order things actually occurred, with what is still outstanding at the
      * bottom. So that is its own screen rather than another chip here.
      */}
    <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
      <span className="min-h-[38px] shrink-0 rounded-full border border-[var(--brand)] bg-[var(--brand)] px-4 text-xs font-semibold leading-[36px] text-[var(--on-brand)]">
        Visit log
      </span>
      <a href="/admin/visits/day"
        className="min-h-[38px] shrink-0 rounded-full border border-[var(--line-2)] bg-[var(--surface)] px-4 text-xs font-semibold leading-[36px] text-[var(--ink-2)]">
        Day view
      </a>
    </div>

    {/* Plain anchors, like the date filter below and for the same reason: a
        client-side navigation changes the address here without repainting the
        list, so the tab moved while the visits under it did not. */}
    <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
      {tabs.map(tab => {
        const active = status === tab.value || (!status && !tab.value);
        const query = new URLSearchParams({
          ...(tab.value ? { status: tab.value } : {}),
          ...(fromDay ? { from: fromDay } : {}), ...(toDay ? { to: toDay } : {}),
          ...(sampleChoice ? { sample: sampleChoice } : {})
        }).toString();
        return <a key={tab.label} href={query ? `/admin/visits?${query}` : "/admin/visits"}
          className={`min-h-[38px] shrink-0 rounded-full border px-4 text-xs font-semibold leading-[36px] ${
            active ? "border-[var(--brand)] bg-[var(--brand)] text-[var(--on-brand)]" : "border-[var(--line-2)] bg-[var(--surface)] text-[var(--ink-2)]"
          }`}>{tab.label}</a>;
      })}
    </div>

    <VisitDateFilter presets={presets} from={fromDay} to={toDay}
      sample={sampleChoice} status={status} products={products} />

    {visits.length > 0 && chosen && (
      <p className="text-xs text-[var(--muted)]">
        {visits.length === ceiling ? `First ${ceiling}` : visits.length} visit{visits.length === 1 ? "" : "s"} · {chosen}
      </p>
    )}

    {visits.length ? (
      <Card className="divide-y divide-[var(--line)]">
        {visits.map(visit => {
          const attached = photosByVisit.get(String(visit._id)) ?? [];
          return <div key={String(visit._id)} className="px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {/* `block`, because `truncate` does nothing to an inline box. */}
                {visit.doctor ? (
                  <Link href={`/admin/doctors/${visit.doctor._id}`} className="block truncate text-sm font-semibold hover:text-[var(--brand)]">
                    {visit.doctor.name}
                  </Link>
                ) : <p className="text-sm font-semibold">Doctor removed</p>}
                <p className="mt-0.5 text-xs text-[var(--muted)]">
                  {formatDate(visit.plannedDate)}
                  {timeOf(visit) ? ` · ${toDisplayTime(timeOf(visit))}` : ""}
                  {visit.employee?.name ? ` · ${visit.employee.name}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Badge tone={statusTone(visit.status)}>{visit.status}</Badge>
                {/* Nothing but a route plan schedules a visit, so a visit
                    without one was a call the rep made on their own account. */}
                {!visit.routePlan && <Badge tone="neutral">Unplanned</Badge>}
                {visit.interest && <Badge tone={statusTone(visit.interest)}>{visit.interest}</Badge>}
              </div>
            </div>

            {visit.outcome && <p className="mt-2 text-sm text-[var(--ink-2)]">{visit.outcome}</p>}
            {Boolean(visit.productsDiscussed?.length) && (
              <p className="mt-1 text-xs text-[var(--muted)]">Discussed: {visit.productsDiscussed!.join(", ")}</p>
            )}
            {visit.samples?.length ? (
              <p className="mt-1 flex items-start gap-1.5 text-xs font-medium text-[var(--brand)]">
                <Package size={12} className="mt-0.5 shrink-0" />
                <span>Samples given: {visit.samples.map(s => `${s.product} ×${s.quantity}`).join(", ")}</span>
              </p>
            ) : SETTLED.includes(visit.status) && (
              <p className="mt-1 flex items-center gap-1.5 text-xs text-[var(--muted)]">
                <Package size={12} className="shrink-0" />No samples given
              </p>
            )}
            {visit.orderValue ? <p className="mt-1 text-xs font-semibold">Order ₹{visit.orderValue.toLocaleString("en-IN")}</p> : null}
            {visit.notes && <p className="mt-1 text-xs italic text-[var(--muted)]">“{visit.notes}”</p>}

            {attached.length > 0 && (
              <div className="mt-2.5">
                <p className="mb-1.5 flex items-center gap-1.5 text-xs text-[var(--muted)]">
                  <Camera size={12} />{attached.length} photo{attached.length === 1 ? "" : "s"} · oldest removed in {daysLeft(attached[0].expiresAt)} days
                </p>
                {/* Where the phone was standing when they were taken, which is
                    the point of stamping them. Distinct places only: a visit's
                    photos are nearly always all from the one doorway. */}
                {placesOf(attached).length > 0 && (
                  <p className="mb-1.5 flex items-start gap-1.5 text-xs font-medium text-[var(--ink-2)]">
                    <MapPin size={12} className="mt-0.5 shrink-0 text-[var(--brand)]" />
                    {placesOf(attached).join(" · ")}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  {attached.map(photo => (
                    <a key={String(photo._id)} href={`/api/visits/${visit._id}/photos/${photo._id}`}
                      target="_blank" rel="noreferrer"
                      className="relative size-16 overflow-hidden rounded-[10px] border border-[var(--line-2)] bg-[var(--surface-2)]">
                      {/* Unoptimized: private bytes with a thirty-day life of
                          their own, which the image cache must not outlive. */}
                      <Image src={`/api/visits/${visit._id}/photos/${photo._id}`} alt={`Photo from the visit on ${formatDate(visit.plannedDate)}`}
                        fill unoptimized sizes="64px" className="object-cover" />
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>;
        })}
      </Card>
    ) : (
      <EmptyState icon={ClipboardList} title={chosen ? "Nothing matches that" : "No visits here"}
        description={chosen
          ? `Nothing was recorded for ${chosen}. Widen the search, or clear it to read the whole log.`
          : "Visits appear once a route plan is assigned to a representative, or when one registers a call they made without a plan."} />
    )}
  </div>;
}
