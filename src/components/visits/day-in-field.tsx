import Link from "next/link";
import { ClipboardList, Clock, MapPin, Navigation, Package, Route, TrendingUp } from "lucide-react";
import { Badge, Card, EmptyState, Stat } from "@/components/ui/kit";
import { clockOf, formatDate, formatDuration, toDisplayTime } from "@/lib/time";
import { describeState, type Round } from "@/lib/rounds";

/**
 * One day in the field, drawn rep by rep — the same picture whether the desk
 * is reading it for the whole team or a rep is reading their own.
 *
 * The pages that use this do the querying and hand over built rounds; this
 * file only draws. What differs between the two panels is where a name links
 * to, and whether a rep's name is worth a heading at all when the reader *is*
 * the rep — so both are props rather than baked-in paths.
 */

export type DayLinks = {
  /** Where a doctor's name goes. */
  doctor: (id: string) => string;
  /** Where a rep's name goes — omitted when the reader is the rep. */
  employee?: (id: string) => string;
};

export const rupees = (value: number) => `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

/** "1.4 km", or metres once a leg is short enough for kilometres to read as zero. */
const distance = (km: number) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`);

/** "—" rather than "0m", so a figure nobody has earned yet is not reported as one. */
const duration = (minutes: number) => (minutes > 0 ? formatDuration(minutes) : "—");

export function DayInField({ rounds, day, isToday, links, emptyTitle, emptyDescription }: {
  rounds: Round[];
  day: string;
  isToday: boolean;
  links: DayLinks;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  // The day across everybody, for the strip at the top. Summed from the rounds
  // rather than re-queried, so the total can never disagree with the cards.
  const across = {
    reps: rounds.length,
    working: rounds.filter(round => round.state === "in-progress").length,
    completed: rounds.reduce((total, round) => total + round.completed, 0),
    missed: rounds.reduce((total, round) => total + round.missed, 0),
    pending: rounds.reduce((total, round) => total + round.pending, 0),
    sampleUnits: rounds.reduce((total, round) => total + round.sampleUnits, 0),
    orderValue: rounds.reduce((total, round) => total + round.orderValue, 0),
    inClinicMinutes: rounds.reduce((total, round) => total + round.inClinicMinutes, 0)
  };

  if (!rounds.length) {
    return <EmptyState icon={ClipboardList} title={emptyTitle ?? `Nothing recorded for ${formatDate(day)}`}
      description={emptyDescription ?? (isToday
        ? "No route plan has been assigned for today, and nobody has registered a call of their own yet."
        : "No plan was assigned that day, and no unplanned calls were registered.")} />;
  }

  // A single rep reading their own day gets the summary on their card already;
  // the strip across everybody only earns its place once there is an everybody.
  const teamWide = Boolean(links.employee);

  return <>
    {teamWide && (
      <Card className="p-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
          <Stat label="Reps out" value={across.reps} />
          <Stat label="Still working" value={across.working} />
          <Stat label="Calls done" value={across.completed} />
          <Stat label="Missed" value={across.missed} tone={across.missed ? "text-[var(--warn-ink)]" : undefined} />
          <Stat label="Still to visit" value={across.pending} />
          <Stat label="Sample units" value={across.sampleUnits} />
          <Stat label="Orders taken" value={rupees(across.orderValue)} />
        </div>
        <p className="mt-3 text-xs text-[var(--muted)]">
          {duration(across.inClinicMinutes)} spent inside clinics across everybody.
        </p>
      </Card>
    )}

    {rounds.map(round => <RoundCard key={round.employeeId} round={round} isToday={isToday} links={links} />)}
  </>;
}

/**
 * The head of a round: who, how far through, and the day's figures.
 *
 * Exported on its own because the rep's first screen wants exactly this much
 * — the numbers without the call list it already shows in visiting order.
 */
export function RoundSummary({ round, isToday, links, title }: {
  round: Round; isToday: boolean; links: DayLinks;
  /** What to call the round when there is no rep's name to head it with. */
  title?: string;
}) {
  const state = describeState(round, isToday);
  const done = round.completed + round.missed;
  // Out of everything on the day, so the bar reads as progress through a round
  // rather than as a mark out of what has been attempted.
  const share = round.total ? Math.round((done / round.total) * 100) : 0;

  return <div className="px-5 py-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {links.employee ? (
          <Link href={links.employee(round.employeeId)}
            className="text-base font-semibold hover:text-[var(--brand)]">{round.employeeName}</Link>
        ) : <p className="text-base font-semibold">{title ?? "Your round"}</p>}
        <p className="mt-0.5 text-xs text-[var(--muted)]">
          {round.planName ? round.planName : "No plan assigned — own calls only"}
          {round.plannedDistanceKm ? ` · ${Math.round(round.plannedDistanceKm)} km planned` : ""}
          {round.firstCheckInAt ? ` · started ${clockOf(round.firstCheckInAt)}` : ""}
          {round.lastActivityAt && round.state !== "not-started" ? ` · last seen ${clockOf(round.lastActivityAt)}` : ""}
        </p>
      </div>
      <Badge tone={state.tone}>{state.label}</Badge>
    </div>

    {/* The bar is the thing somebody reads first, so it says its own numbers. */}
    <div className="mt-3">
      <div className="flex items-center justify-between text-xs font-medium">
        <span>{done} of {round.total} visited</span>
        <span className="text-[var(--muted)]">{share}%</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
        <div className="h-full rounded-full bg-[var(--brand)] transition-[width]" style={{ width: `${share}%` }} />
      </div>
    </div>

    <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-7">
      <Stat label="Worked" value={duration(round.workedMinutes)} />
      <Stat label="In clinics" value={duration(round.inClinicMinutes)} />
      <Stat label="Travel & waiting" value={duration(round.betweenMinutes)} />
      <Stat label="Average call" value={round.averageCallMinutes ? formatDuration(round.averageCallMinutes) : "—"} />
      <Stat label="Distance covered" value={round.travelledKm ? distance(round.travelledKm) : "—"} />
      <Stat label="Sample units" value={round.sampleUnits} />
      <Stat label="Orders" value={rupees(round.orderValue)} />
    </div>

    {/*
      * A round walked in 61 km against a plan of 43 went somewhere it was not
      * meant to; one walked in 12 is a plan mostly not attempted. Said only
      * when there is a plan to compare against.
      */}
    {round.plannedDistanceKm && round.travelledKm > 0 && (
      <p className="mt-2 flex items-start gap-1.5 text-xs text-[var(--muted)]">
        <Navigation size={12} className="mt-0.5 shrink-0" />
        {distance(round.travelledKm)} between the calls actually made, against {Math.round(round.plannedDistanceKm)} km planned
        {round.travelledApproximate ? " — some legs measured from a registered address" : ""}.
      </p>
    )}

    {/*
      * Said out loud when the in-clinic figure is built from fewer calls than
      * were made — a visit checked into and never closed has no duration, and
      * an average quietly computed over four of six calls is a figure somebody
      * would otherwise take at face value.
      */}
    {round.measuredCalls < done && (
      <p className="mt-2 flex items-start gap-1.5 text-xs text-[var(--muted)]">
        <Clock size={12} className="mt-0.5 shrink-0" />
        Timings come from {round.measuredCalls} of {done} calls — the rest were never checked out of.
      </p>
    )}

    {round.samplesByProduct.length > 0 && (
      <p className="mt-2 flex items-start gap-1.5 text-xs text-[var(--ink-2)]">
        <Package size={12} className="mt-0.5 shrink-0 text-[var(--brand)]" />
        <span>{round.samplesByProduct.map(sample => `${sample.product} ×${sample.quantity}`).join(" · ")}</span>
      </p>
    )}
  </div>;
}

function RoundCard({ round, isToday, links }: { round: Round; isToday: boolean; links: DayLinks }) {
  return <Card className="overflow-hidden">
    <RoundSummary round={round} isToday={isToday} links={links} />

    <ol className="divide-y divide-[var(--line)] border-t border-[var(--line)]">
      {round.visits.map(visit => {
        const pending = !visit.settled;
        return <li key={visit.id} className={`flex gap-3 px-5 py-3.5 ${pending ? "bg-[var(--surface-2)]" : ""}`}>
          {/*
            * A number for a call that happened and a dash for one that has not.
            * Numbering the whole list would imply the pending stops occurred in
            * that order, which is the one thing this screen must not say.
            */}
          <span className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-bold ${
            pending ? "bg-[var(--surface)] text-[var(--muted)] ring-1 ring-[var(--line-2)]"
              : visit.status === "Missed" ? "bg-[var(--danger-bg)] text-[var(--danger-ink)]"
              : "bg-[var(--brand)] text-[var(--on-brand)]"
          }`}>
            {pending ? "·" : visit.position}
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <div className="min-w-0">
                {visit.doctor ? (
                  <Link href={links.doctor(visit.doctor.id)}
                    className="block truncate text-sm font-semibold hover:text-[var(--brand)]">
                    {visit.doctor.name}
                  </Link>
                ) : <p className="text-sm font-semibold">Doctor removed</p>}
                {(visit.doctor?.area || visit.doctor?.city) && (
                  <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-[var(--muted)]">
                    <MapPin size={11} className="shrink-0" />
                    {[visit.doctor?.area, visit.doctor?.city].filter(Boolean).join(", ")}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                {visit.unplanned && <Badge tone="neutral">Unplanned</Badge>}
                {visit.status === "Missed" && <Badge tone="danger">Missed</Badge>}
                {visit.status === "In progress" && <Badge tone="info">In the clinic now</Badge>}
                {pending && visit.status === "Planned" && <Badge tone="neutral">To visit</Badge>}
                {visit.interest && visit.settled && <Badge tone="success">{visit.interest}</Badge>}
              </div>
            </div>

            <p className="mt-1 text-xs text-[var(--muted)]">
              {visit.checkInAt
                ? <>
                    {clockOf(visit.checkInAt)}
                    {visit.checkOutAt ? `–${clockOf(visit.checkOutAt)}` : " · still open"}
                    {visit.minutes != null ? ` · ${formatDuration(visit.minutes)} inside` : ""}
                  </>
                : visit.plannedStart ? `Planned for ${toDisplayTime(visit.plannedStart)}` : "No time planned"}
            </p>

            {/*
              * The journey that got them here, on its own line and above the
              * call rather than below it — a leg belongs to the arrival, and
              * reading "8 km, 40 minutes" before "met the doctor" is the order
              * somebody tells the day in.
              */}
            {(visit.distanceKm != null || visit.gapMinutes != null) && (
              <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-[var(--ink-2)]">
                <Navigation size={11} className="shrink-0 text-[var(--muted)]" />
                {visit.distanceKm != null && <span className="font-semibold tabular-nums">{distance(visit.distanceKm)}</span>}
                {visit.distanceKm != null && visit.gapMinutes != null && <span className="text-[var(--muted)]">·</span>}
                {visit.gapMinutes != null && <span>{formatDuration(visit.gapMinutes)} since the last call</span>}
                {/*
                  * Marked when a leg was measured from the clinic's registered
                  * address rather than from where the phone actually was. It is
                  * usually right and is not evidence of anybody having been
                  * there, which is a distinction worth one word.
                  */}
                {visit.distanceFrom === "registered" && (
                  <span className="text-[var(--muted)]" title="Measured from the clinic's registered address, the phone having had no fix">
                    · by address
                  </span>
                )}
              </p>
            )}

            {visit.outcome && <p className="mt-1.5 text-sm font-medium text-[var(--ink)]">{visit.outcome}</p>}
            {visit.notes && (
              <p className="mt-1 border-l-2 border-[var(--line-2)] pl-2.5 text-xs italic text-[var(--ink-2)]">
                &ldquo;{visit.notes}&rdquo;
              </p>
            )}

            {/* Chips, as on the log — stock that has left the building is the
                figure a rep's month is judged on, and it should be the thing on
                the row that catches the eye. */}
            {visit.samples?.length ? (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Package size={12} className="shrink-0 text-[var(--brand)]" />
                {visit.samples.map(sample => (
                  <span key={sample.product}
                    className="inline-flex items-center gap-1 rounded-full border border-[var(--line-2)] bg-[var(--brand-soft)] px-2 py-0.5 text-xs font-medium">
                    {sample.product}
                    <span className="font-bold tabular-nums text-[var(--brand)]">×{sample.quantity}</span>
                  </span>
                ))}
              </div>
            ) : null}

            {visit.orderValue ? (
              <p className="mt-1.5 text-xs font-semibold text-[var(--ok-ink)]">Order {rupees(visit.orderValue)}</p>
            ) : null}
          </div>
        </li>;
      })}
    </ol>

    {round.pending > 0 && (
      <p className="flex items-center gap-1.5 border-t border-[var(--line)] px-5 py-3 text-xs font-medium text-[var(--ink-2)]">
        {isToday
          ? <><Route size={13} className="text-[var(--brand)]" />{round.pending} clinic{round.pending === 1 ? "" : "s"} still to visit today.</>
          : <><TrendingUp size={13} className="text-[var(--warn-ink)]" />{round.pending} clinic{round.pending === 1 ? "" : "s"} were never visited that day.</>}
      </p>
    )}
  </Card>;
}
