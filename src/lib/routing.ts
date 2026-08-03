import { toMinutes } from "./time";

export type Coordinates = { latitude: number; longitude: number };
export type CallSlot = { start: string; end: string };

export type RoutableDoctor = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  /** Call windows for the planned weekday. Empty means no confirmed timing. */
  slots: CallSlot[];
  appointmentRequired?: boolean;
};

export type PlannedStop = {
  id: string;
  sequence: number;
  distanceFromPreviousKm: number;
  travelMinutes: number;
  /** When the rep arrives, and when the meeting can actually begin. */
  arrivalMinutes: number;
  startMinutes: number;
  endMinutes: number;
  waitMinutes: number;
  /** False when the doctor's call window could not be honoured. */
  withinCallTime: boolean;
  /** True when the doctor has no confirmed call timing at all. */
  timingUnknown: boolean;
};

export type RoutePlanResult = {
  stops: PlannedStop[];
  totalDistanceKm: number;
  totalTravelMinutes: number;
  finishMinutes: number;
  outsideCallTimeCount: number;
  unknownTimingCount: number;
};

export type PlanOptions = {
  /** Time the rep starts the day, e.g. "09:30". */
  startTime: string;
  /** Minutes spent with each doctor. */
  visitMinutes: number;
  /** Average driving speed used to convert distance into travel time. */
  speedKmh?: number;
};

const EARTH_RADIUS_KM = 6371;
/**
 * Stops whose meetings begin within this many minutes of each other are treated
 * as equally urgent, so distance decides the order between them. Without this
 * bucket, a doctor two minutes earlier but ten kilometres away would always win.
 */
const TIME_BUCKET_MINUTES = 30;

export function haversineKm(from: Coordinates, to: Coordinates): number {
  const dLat = (to.latitude - from.latitude) * Math.PI / 180;
  const dLon = (to.longitude - from.longitude) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(from.latitude * Math.PI / 180) * Math.cos(to.latitude * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

type Window = { start: number; end: number };

function windowsOf(doctor: RoutableDoctor): Window[] {
  return doctor.slots
    .map(slot => ({ start: toMinutes(slot.start), end: toMinutes(slot.end) }))
    .filter((w): w is Window => w.start !== null && w.end !== null && w.end > w.start)
    .sort((a, b) => a.start - b.start);
}

/**
 * Picks when a visit can start given the arrival time.
 * Prefers a window the rep can actually meet; waiting for one to open is fine,
 * arriving after one closes is not. Returns null when no window fits, which the
 * caller reports rather than silently pretending the visit is on time.
 */
function scheduleWithin(windows: Window[], arrival: number, visitMinutes: number): number | null {
  for (const window of windows) {
    const start = Math.max(arrival, window.start);
    if (start + visitMinutes <= window.end) return start;
  }
  return null;
}

/**
 * Orders a day's doctors so their call timings are respected first and travel
 * distance second — the order a medical rep actually needs, because a doctor who
 * only sees reps from 2–4 PM cannot be visited at 10 AM however close they are.
 *
 * Greedy nearest-feasible-next: from each stop, look at every remaining doctor,
 * work out when the meeting could begin, and take the one that starts soonest —
 * breaking ties by distance so nearby doctors in the same window stay together.
 * Doctors whose window can no longer be met are appended at the end and flagged.
 */
export function planRoute(doctors: RoutableDoctor[], referenceId: string, options: PlanOptions): RoutePlanResult {
  const reference = doctors.find(doctor => doctor.id === referenceId);
  if (!reference) throw new Error("The starting doctor is not part of the selected list");

  const dayStart = toMinutes(options.startTime);
  if (dayStart === null) throw new Error("Start time must be in HH:MM format");
  const speedKmh = options.speedKmh ?? 25;
  const { visitMinutes } = options;

  const travelTime = (from: Coordinates, to: Coordinates) => (haversineKm(from, to) / speedKmh) * 60;

  const remaining = doctors.filter(doctor => doctor.id !== referenceId);
  const stops: PlannedStop[] = [];

  const referenceWindows = windowsOf(reference);
  const referenceStart = referenceWindows.length
    ? scheduleWithin(referenceWindows, dayStart, visitMinutes) ?? dayStart
    : dayStart;

  stops.push({
    id: reference.id,
    sequence: 1,
    distanceFromPreviousKm: 0,
    travelMinutes: 0,
    arrivalMinutes: dayStart,
    startMinutes: referenceStart,
    endMinutes: referenceStart + visitMinutes,
    waitMinutes: Math.max(0, referenceStart - dayStart),
    withinCallTime: referenceWindows.length === 0 || scheduleWithin(referenceWindows, dayStart, visitMinutes) !== null,
    timingUnknown: referenceWindows.length === 0
  });

  let current: RoutableDoctor = reference;
  let clock = referenceStart + visitMinutes;
  let totalDistanceKm = 0;
  let totalTravelMinutes = 0;

  while (remaining.length) {
    type Candidate = { index: number; distanceKm: number; travel: number; arrival: number; start: number; feasible: boolean; unknown: boolean };
    let best: Candidate | null = null;

    for (let index = 0; index < remaining.length; index++) {
      const candidate = remaining[index];
      const distanceKm = haversineKm(current, candidate);
      const travel = travelTime(current, candidate);
      const arrival = clock + travel;
      const windows = windowsOf(candidate);
      const feasibleStart = windows.length ? scheduleWithin(windows, arrival, visitMinutes) : arrival;
      const start = feasibleStart ?? arrival;
      const entry: Candidate = {
        index, distanceKm, travel, arrival, start,
        feasible: feasibleStart !== null,
        unknown: windows.length === 0
      };

      if (!best) { best = entry; continue; }
      // A doctor we can still reach in time always beats one we have already missed.
      if (entry.feasible !== best.feasible) { if (entry.feasible) best = entry; continue; }
      const bucket = Math.floor(entry.start / TIME_BUCKET_MINUTES);
      const bestBucket = Math.floor(best.start / TIME_BUCKET_MINUTES);
      if (bucket !== bestBucket) { if (bucket < bestBucket) best = entry; continue; }
      if (entry.distanceKm < best.distanceKm) best = entry;
    }

    if (!best) break;
    const [chosen] = remaining.splice(best.index, 1);
    totalDistanceKm += best.distanceKm;
    totalTravelMinutes += best.travel;

    stops.push({
      id: chosen.id,
      sequence: stops.length + 1,
      distanceFromPreviousKm: Number(best.distanceKm.toFixed(2)),
      travelMinutes: Math.round(best.travel),
      arrivalMinutes: Math.round(best.arrival),
      startMinutes: Math.round(best.start),
      endMinutes: Math.round(best.start + visitMinutes),
      waitMinutes: Math.max(0, Math.round(best.start - best.arrival)),
      withinCallTime: best.feasible,
      timingUnknown: best.unknown
    });

    current = chosen;
    clock = best.start + visitMinutes;
  }

  return {
    stops,
    totalDistanceKm: Number(totalDistanceKm.toFixed(2)),
    totalTravelMinutes: Math.round(totalTravelMinutes),
    finishMinutes: Math.round(clock),
    outsideCallTimeCount: stops.filter(stop => !stop.withinCallTime).length,
    unknownTimingCount: stops.filter(stop => stop.timingUnknown).length
  };
}
