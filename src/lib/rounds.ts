/**
 * A representative's day as it actually went, rather than as it was planned.
 *
 * The route plan answers "where should they be at two o'clock". This answers the
 * question an administrator asks at four: **has it happened?** Which clinics have
 * they got to, in what order, how long each call took, what went out of the bag,
 * and what is still standing between them and going home.
 *
 * That is deliberately not the same screen as the plan. A plan is nine stops in
 * distance order with tidy 45-minute slots; a real day is six of them in a
 * different order, one clinic closed, an unplanned call squeezed in at noon and
 * three still to go. Showing the plan and calling it progress is how a desk comes
 * to believe a round is on schedule when it is two hours behind.
 *
 * Pure — no Mongoose, no React, and no `Date.now()`. Every figure here is derived
 * from what was recorded, so a day reads the same at four in the afternoon as it
 * does when somebody looks at it again next March.
 */

export type RoundSample = { product: string; quantity: number };

export type RoundVisitInput = {
  id: string;
  status: string;
  plannedStart?: string;
  checkInAt?: Date | string;
  checkOutAt?: Date | string;
  outcome?: string;
  interest?: string;
  notes?: string;
  orderValue?: number;
  samples?: RoundSample[];
  productsDiscussed?: string[];
  /** Absent means the rep made this call on their own account. */
  routePlan?: string | null;
  doctor?: { id: string; name?: string; area?: string; city?: string };
};

export type RoundVisit = RoundVisitInput & {
  /** Where it sits in the order things actually happened. 1-based. */
  position: number;
  /** Minutes between checking in and out. Absent when one of them is missing. */
  minutes?: number;
  /** Minutes since the previous call was left — travel, lunch, waiting. */
  gapMinutes?: number;
  /** Nothing but a route plan schedules a visit. */
  unplanned: boolean;
  /** Has been to, or tried to get to. */
  settled: boolean;
};

/**
 * Where the day stands, without reference to the clock.
 *
 * `in-progress` means started and not finished, which on today's date reads as
 * "they are still out" and on a past date reads as "this was left unfinished" —
 * two very different sentences from one honest fact. The screen supplies the
 * reading; this supplies the fact.
 */
export type RoundState = "not-started" | "in-progress" | "complete";

export type Round = {
  employeeId: string;
  employeeName: string;
  /** "yyyy-mm-dd". */
  date: string;
  planName?: string;
  plannedDistanceKm?: number;

  /** Everything that happened, in the order it happened, then what is still due. */
  visits: RoundVisit[];
  total: number;
  completed: number;
  missed: number;
  pending: number;
  /** Completed as a share of everything settled, so a day still running is fair. */
  completionRate: number;

  firstCheckInAt?: Date;
  lastActivityAt?: Date;
  /**
   * First call to last recorded action.
   *
   * Not "until now", deliberately. A rep whose last check-out was at two would
   * otherwise accumulate working hours all evening, and the figure would say
   * something about the reader's clock rather than about the rep's day.
   */
  workedMinutes: number;
  /** Time inside clinics, summed over the calls that recorded both ends. */
  inClinicMinutes: number;
  /** What is left of the working span — travelling, waiting, eating. */
  betweenMinutes: number;
  /** How many calls the in-clinic figure is actually built from. */
  measuredCalls: number;
  averageCallMinutes?: number;

  sampleUnits: number;
  samplesByProduct: RoundSample[];
  orderValue: number;
  state: RoundState;
};

const SETTLED = new Set(["Completed", "Missed"]);

const at = (value: Date | string | undefined): Date | undefined => {
  if (!value) return undefined;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

const minutesBetween = (from: Date, to: Date) => Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000));

/**
 * "14:00" as minutes past midnight, for ordering calls that have not happened
 * yet. Anything unparseable sorts last rather than to the top of the morning.
 */
const plannedMinutes = (value?: string) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value ?? "");
  return match ? Number(match[1]) * 60 + Number(match[2]) : Number.MAX_SAFE_INTEGER;
};

/**
 * The day's calls in the order a person would tell it.
 *
 * Anything with a check-in is ordered by when that happened — which is the whole
 * point, since a rep who took the third clinic first should read that way rather
 * than being straightened back into the plan. Everything still ahead follows, in
 * the order it is meant to happen.
 *
 * A missed call with no check-in is settled but never happened, so it sorts with
 * the pending ones by its planned time; it would otherwise have to be given an
 * invented position in a sequence of real events.
 */
function order(visits: readonly RoundVisitInput[]): RoundVisitInput[] {
  const started = visits.filter(visit => at(visit.checkInAt));
  const rest = visits.filter(visit => !at(visit.checkInAt));

  started.sort((left, right) => at(left.checkInAt)!.getTime() - at(right.checkInAt)!.getTime());
  rest.sort((left, right) => plannedMinutes(left.plannedStart) - plannedMinutes(right.plannedStart));

  return [...started, ...rest];
}

/** Every product handed over in the day, each once, heaviest first. */
export function tallySamples(visits: readonly RoundVisitInput[]): RoundSample[] {
  const units = new Map<string, number>();
  for (const visit of visits) {
    for (const sample of visit.samples ?? []) {
      if (!sample.product) continue;
      units.set(sample.product, (units.get(sample.product) ?? 0) + Math.max(0, sample.quantity || 0));
    }
  }
  return [...units]
    .map(([product, quantity]) => ({ product, quantity }))
    .sort((left, right) => right.quantity - left.quantity || left.product.localeCompare(right.product));
}

/**
 * One rep's day, assembled.
 *
 * Takes what was recorded and returns what it means. The caller does the
 * querying; everything arithmetical happens here, where it can be tested against
 * a day with a clinic closed in the middle of it.
 */
export function buildRound({ employeeId, employeeName, date, planName, plannedDistanceKm, visits }: {
  employeeId: string;
  employeeName: string;
  date: string;
  planName?: string;
  plannedDistanceKm?: number;
  visits: readonly RoundVisitInput[];
}): Round {
  const ordered = order(visits);

  let previousLeft: Date | undefined;
  const enriched: RoundVisit[] = ordered.map((visit, index) => {
    const checkIn = at(visit.checkInAt);
    const checkOut = at(visit.checkOutAt);

    const row: RoundVisit = {
      ...visit,
      position: index + 1,
      minutes: checkIn && checkOut ? minutesBetween(checkIn, checkOut) : undefined,
      gapMinutes: checkIn && previousLeft ? minutesBetween(previousLeft, checkIn) : undefined,
      unplanned: !visit.routePlan,
      settled: SETTLED.has(visit.status)
    };

    // The next gap is measured from wherever this call actually ended — its
    // check-out if it has one, otherwise its check-in, so a call left open does
    // not make the following gap look like the whole afternoon.
    if (checkOut ?? checkIn) previousLeft = checkOut ?? checkIn;
    return row;
  });

  const checkIns = enriched.map(visit => at(visit.checkInAt)).filter(Boolean) as Date[];
  const stamps = [...checkIns, ...enriched.map(visit => at(visit.checkOutAt)).filter(Boolean) as Date[]];

  const firstCheckInAt = checkIns.length ? new Date(Math.min(...checkIns.map(date => date.getTime()))) : undefined;
  const lastActivityAt = stamps.length ? new Date(Math.max(...stamps.map(date => date.getTime()))) : undefined;

  const measured = enriched.filter(visit => typeof visit.minutes === "number");
  const inClinicMinutes = measured.reduce((total, visit) => total + visit.minutes!, 0);
  const workedMinutes = firstCheckInAt && lastActivityAt ? minutesBetween(firstCheckInAt, lastActivityAt) : 0;

  const completed = enriched.filter(visit => visit.status === "Completed").length;
  const missed = enriched.filter(visit => visit.status === "Missed").length;
  const pending = enriched.length - completed - missed;

  return {
    employeeId,
    employeeName,
    date,
    planName,
    plannedDistanceKm,
    visits: enriched,
    total: enriched.length,
    completed,
    missed,
    pending,
    /*
     * Out of what has been settled, not out of the whole day.
     *
     * A rep three calls into a round of nine has completed three of three
     * attempted, not three of nine — judging them at lunchtime against a day
     * they have not finished is how a live screen becomes one nobody trusts.
     */
    completionRate: completed + missed ? Math.round((completed / (completed + missed)) * 100) : 0,
    firstCheckInAt,
    lastActivityAt,
    workedMinutes,
    inClinicMinutes,
    // Never negative: a call whose check-out precedes the next one's check-in by
    // a hand-edited timestamp should not produce a negative afternoon.
    betweenMinutes: Math.max(0, workedMinutes - inClinicMinutes),
    measuredCalls: measured.length,
    averageCallMinutes: measured.length ? Math.round(inClinicMinutes / measured.length) : undefined,
    sampleUnits: enriched.reduce((total, visit) =>
      total + (visit.samples ?? []).reduce((sum, sample) => sum + Math.max(0, sample.quantity || 0), 0), 0),
    samplesByProduct: tallySamples(enriched),
    orderValue: enriched.reduce((total, visit) => total + Math.max(0, visit.orderValue ?? 0), 0),
    state: !checkIns.length ? "not-started" : pending ? "in-progress" : "complete"
  };
}

/**
 * How a round's state reads on the day in question.
 *
 * The same fact means different things depending on whether the day is still
 * running: `in-progress` today is "still out there", and `in-progress` last
 * Tuesday is "this was never finished" — which is a thing somebody should be
 * asked about rather than a thing that scrolls past.
 */
export function describeState(round: Round, isToday: boolean): { label: string; tone: "success" | "info" | "warn" | "neutral" } {
  if (round.state === "complete") return { label: "Round complete", tone: "success" };
  if (round.state === "not-started") {
    return isToday
      ? { label: "Not started", tone: "neutral" }
      : { label: "Never started", tone: "warn" };
  }
  return isToday
    ? { label: `In progress · ${round.pending} to go`, tone: "info" }
    : { label: `Left unfinished · ${round.pending} not visited`, tone: "warn" };
}

/** Sorts the busiest day to the top, and anybody who never set off to the bottom. */
export const byProgress = (left: Round, right: Round) =>
  right.completed - left.completed
  || right.total - left.total
  || left.employeeName.localeCompare(right.employeeName);
