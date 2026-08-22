import { Types } from "mongoose";
import { Visit } from "@/models/Visit";
import { RoutePlan } from "@/models/RoutePlan";
import { dayRange } from "@/lib/time";
import { buildRound, byProgress, type Round, type RoundVisitInput } from "@/lib/rounds";

/**
 * The rounds walked on one day, built from the database.
 *
 * Shared by the desk's day view and the rep's own: the only difference between
 * them is whether the visits are narrowed to one employee, so that is the one
 * option. The arithmetic lives in `lib/rounds`; this file queries and maps.
 */

type VisitDoc = {
  _id: unknown; status: string; plannedStart?: string; checkInAt?: Date; checkOutAt?: Date;
  outcome?: string; interest?: string; notes?: string; orderValue?: number; routePlan?: unknown;
  checkInLocation?: { latitude?: number; longitude?: number };
  samples?: Array<{ product: string; quantity: number }>; productsDiscussed?: string[];
  /** `location` is GeoJSON on the doctor: `coordinates` is [longitude, latitude]. */
  doctor?: { _id: unknown; name?: string; area?: string; city?: string; location?: { coordinates?: number[] } };
  employee?: { _id: unknown; name?: string };
};

type PlanDoc = { _id: unknown; name?: string; assignedTo?: unknown; totalDistanceKm?: number };

/**
 * A doctor's stored point as the distance helpers want it.
 *
 * GeoJSON orders a position `[longitude, latitude]`; everything in `lib/routing`
 * takes `{ latitude, longitude }`. Swapping them does not throw — it moves a
 * Mumbai clinic into the Indian Ocean and reports the leg as nine hundred
 * kilometres — so the unpacking happens once, here.
 */
const doctorFix = (location?: { coordinates?: number[] }) => {
  const [longitude, latitude] = location?.coordinates ?? [];
  return typeof latitude === "number" && typeof longitude === "number" ? { latitude, longitude } : undefined;
};

export async function loadRounds({ day, employeeId }: { day: string; employeeId?: string }): Promise<Round[]> {
  const range = dayRange(day, day)!;
  const only = employeeId ? { employee: new Types.ObjectId(employeeId) } : {};
  const onlyPlan = employeeId ? { assignedTo: new Types.ObjectId(employeeId) } : {};

  const [visits, plans] = await Promise.all([
    Visit.find({ plannedDate: range, ...only })
      .populate("doctor", "name area city location")
      .populate("employee", "name")
      .sort({ plannedStart: 1 })
      .lean() as unknown as Promise<VisitDoc[]>,
    RoutePlan.find({ date: range, ...onlyPlan })
      .select("name assignedTo totalDistanceKm")
      .lean() as unknown as Promise<PlanDoc[]>
  ]);

  /*
   * Grouped by the person, because the question is about a person's day. A visit
   * whose employee record has been deleted is dropped rather than gathered under
   * a heading with no name — the Visits log still holds it.
   */
  const byEmployee = new Map<string, { name: string; visits: RoundVisitInput[] }>();
  for (const visit of visits) {
    const id = visit.employee?._id ? String(visit.employee._id) : "";
    if (!id) continue;

    const bucket = byEmployee.get(id) ?? { name: visit.employee?.name ?? "Unnamed", visits: [] };
    bucket.visits.push({
      id: String(visit._id),
      status: visit.status,
      plannedStart: visit.plannedStart,
      checkInAt: visit.checkInAt,
      checkOutAt: visit.checkOutAt,
      outcome: visit.outcome,
      interest: visit.interest,
      notes: visit.notes,
      orderValue: visit.orderValue,
      samples: visit.samples,
      productsDiscussed: visit.productsDiscussed,
      routePlan: visit.routePlan ? String(visit.routePlan) : null,
      checkInLocation: visit.checkInLocation,
      doctor: visit.doctor
        ? {
            id: String(visit.doctor._id),
            name: visit.doctor.name,
            area: visit.doctor.area,
            city: visit.doctor.city,
            location: doctorFix(visit.doctor.location)
          }
        : undefined
    });
    byEmployee.set(id, bucket);
  }

  const planFor = new Map(plans
    .filter(plan => plan.assignedTo)
    .map(plan => [String(plan.assignedTo), plan]));

  return [...byEmployee]
    .map(([id, bucket]) => buildRound({
      employeeId: id,
      employeeName: bucket.name,
      date: day,
      planName: planFor.get(id)?.name,
      plannedDistanceKm: planFor.get(id)?.totalDistanceKm,
      visits: bucket.visits
    }))
    .sort(byProgress);
}
