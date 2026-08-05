import { connectDb } from "@/lib/db/mongoose";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok } from "@/lib/api";
import { buildPlan, planInputSchema, PlanError } from "@/lib/plans";
import { toClock } from "@/lib/time";

export async function POST(request: Request) {
  try {
    // Previewing changes nothing, and a rep planning their own day needs it as
    // much as the office does.
    const auth = await apiSession(role => can.planRoutes(role) || can.planOwnRoute(role));
    if ("response" in auth) return auth.response;
    await connectDb();

    const input = planInputSchema.parse(await request.json());
    const { result, doctors, weekday } = await buildPlan(input);
    const byId = new Map(doctors.map(doctor => [String(doctor._id), doctor]));

    return ok({
      weekday,
      totalDistanceKm: result.totalDistanceKm,
      totalTravelMinutes: result.totalTravelMinutes,
      finishTime: toClock(result.finishMinutes),
      outsideCallTimeCount: result.outsideCallTimeCount,
      unknownTimingCount: result.unknownTimingCount,
      stops: result.stops.map(stop => ({
        sequence: stop.sequence,
        doctor: byId.get(stop.id),
        distanceFromPreviousKm: stop.distanceFromPreviousKm,
        travelMinutes: stop.travelMinutes,
        waitMinutes: stop.waitMinutes,
        plannedStart: toClock(stop.startMinutes),
        plannedEnd: toClock(stop.endMinutes),
        withinCallTime: stop.withinCallTime,
        timingUnknown: stop.timingUnknown
      }))
    });
  } catch (error) {
    if (error instanceof PlanError) return badRequest(error.message);
    return fail(error);
  }
}
