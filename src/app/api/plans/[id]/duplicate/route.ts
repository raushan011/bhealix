import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { RoutePlan } from "@/models/RoutePlan";
import { Visit } from "@/models/Visit";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { buildPlan, PlanError, type PlanInput } from "@/lib/plans";
import { toClock } from "@/lib/time";

const duplicateSchema = z.object({
  dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a valid date")).min(1, "Pick at least one date").max(31)
});

type StoredPlan = {
  name: string; startTime?: string; visitMinutes?: number; assignedTo?: unknown;
  origin?: { kind: "location" | "home" | "custom"; label: string; location: { coordinates: number[] } };
  stops: Array<{ doctor: unknown; sequence: number; remarks?: string }>;
};

/**
 * Copies a plan onto one or more other dates. Each date becomes its own plan —
 * a plan, its visits and its status all hang off a single day — but the doctors,
 * starting point and timing are carried over, and the route is rebuilt for each
 * date's weekday so a doctor's call window on that day is respected.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.planRoutes);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Invalid plan reference");

    const { dates } = duplicateSchema.parse(await request.json());
    const unique = [...new Set(dates)].sort();

    await connectDb();
    const source = await RoutePlan.findById(id).lean() as StoredPlan | null;
    if (!source) return badRequest("Plan not found", 404);

    const ordered = [...source.stops].sort((a, b) => a.sequence - b.sequence);
    const doctorIds = ordered.map(stop => String(stop.doctor));
    const origin: PlanInput["origin"] = source.origin
      ? { kind: source.origin.kind, label: source.origin.label,
        longitude: source.origin.location.coordinates[0], latitude: source.origin.location.coordinates[1] }
      : { kind: "doctor", doctorId: doctorIds[0] };
    const remarksByDoctor = new Map(ordered.filter(stop => stop.remarks).map(stop => [String(stop.doctor), stop.remarks!]));
    const assignedTo = source.assignedTo ? String(source.assignedTo) : undefined;

    const created: string[] = [];
    for (const dateText of unique) {
      const input: PlanInput = {
        date: dateText, origin, doctorIds,
        startTime: source.startTime ?? "09:30", visitMinutes: source.visitMinutes ?? 45
      };
      const { result, weekday } = await buildPlan(input);
      const [year, month, day] = dateText.split("-").map(Number);
      const date = new Date(year, month - 1, day);

      const plan = await RoutePlan.create({
        name: source.name,
        date, weekday,
        startTime: input.startTime,
        visitMinutes: input.visitMinutes,
        ...(source.origin ? { origin: source.origin } : {}),
        stops: result.stops.map(stop => ({
          doctor: stop.id,
          sequence: stop.sequence,
          distanceFromPreviousKm: stop.distanceFromPreviousKm,
          plannedStart: toClock(stop.startMinutes),
          plannedEnd: toClock(stop.endMinutes),
          withinCallTime: stop.withinCallTime,
          timingUnknown: stop.timingUnknown,
          remarks: remarksByDoctor.get(stop.id)
        })),
        totalDistanceKm: result.totalDistanceKm,
        totalTravelMinutes: result.totalTravelMinutes,
        assignedTo,
        createdBy: auth.session.userId,
        status: assignedTo ? "Assigned" : "Draft"
      });

      if (assignedTo) {
        await Visit.insertMany(result.stops.map(stop => ({
          doctor: stop.id,
          employee: assignedTo,
          routePlan: plan._id,
          plannedDate: date,
          plannedStart: toClock(stop.startMinutes),
          status: "Planned"
        })));
      }
      created.push(String(plan._id));
    }

    return ok({ created }, 201);
  } catch (error) {
    if (error instanceof PlanError) return badRequest(error.message);
    return fail(error);
  }
}
