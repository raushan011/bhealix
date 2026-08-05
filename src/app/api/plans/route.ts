import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { RoutePlan } from "@/models/RoutePlan";
import { Visit } from "@/models/Visit";
import { apiSession } from "@/lib/auth/guard";
import { can, usesFieldPanel } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID, pageParams } from "@/lib/api";
import { buildPlan, planInputSchema, PlanError } from "@/lib/plans";
import { toClock } from "@/lib/time";

const createSchema = planInputSchema.extend({
  name: z.string().min(2, "Give the plan a name"),
  assignedTo: z.string().regex(OBJECT_ID).optional()
});

export async function GET(request: Request) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    await connectDb();

    const { page, limit, skip } = pageParams(request.url);
    // Field staff only see plans assigned to them.
    const filter = usesFieldPanel(auth.session.role) ? { assignedTo: auth.session.userId } : {};

    const [items, total] = await Promise.all([
      RoutePlan.find(filter)
        .populate("assignedTo", "name employeeId")
        .populate("stops.doctor", "name clinicName area city")
        .sort({ date: -1 }).skip(skip).limit(limit).lean(),
      RoutePlan.countDocuments(filter)
    ]);
    return ok({ items, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  } catch (error) {
    return fail(error);
  }
}

/**
 * Saves a plan and, when it is assigned, creates one Visit per stop so the rep
 * opens the app to a ready-made day and the admin has something to report on.
 */
export async function POST(request: Request) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;

    const input = createSchema.parse(await request.json());
    // A rep may build their own day and nobody else's; the administrator may
    // build anybody's. Assigning a route to another person is an instruction,
    // and only the office gives those.
    const own = usesFieldPanel(auth.session.role);
    if (own) {
      if (!can.planOwnRoute(auth.session.role)) return badRequest("You do not have access to this action", 403);
      if (input.assignedTo && input.assignedTo !== auth.session.userId) {
        return badRequest("You can only plan your own route", 403);
      }
      input.assignedTo = auth.session.userId;
    } else if (!can.planRoutes(auth.session.role)) {
      return badRequest("You do not have access to this action", 403);
    }

    await connectDb();
    const { result, weekday } = await buildPlan(input);

    const [year, month, day] = input.date.split("-").map(Number);
    const date = new Date(year, month - 1, day);

    const plan = await RoutePlan.create({
      name: input.name,
      date,
      weekday,
      startTime: input.startTime,
      visitMinutes: input.visitMinutes,
      stops: result.stops.map(stop => ({
        doctor: stop.id,
        sequence: stop.sequence,
        distanceFromPreviousKm: stop.distanceFromPreviousKm,
        plannedStart: toClock(stop.startMinutes),
        plannedEnd: toClock(stop.endMinutes),
        withinCallTime: stop.withinCallTime,
        timingUnknown: stop.timingUnknown
      })),
      totalDistanceKm: result.totalDistanceKm,
      totalTravelMinutes: result.totalTravelMinutes,
      assignedTo: input.assignedTo,
      createdBy: auth.session.userId,
      status: input.assignedTo ? "Assigned" : "Draft"
    });

    if (input.assignedTo) {
      await Visit.insertMany(result.stops.map(stop => ({
        doctor: stop.id,
        employee: input.assignedTo,
        routePlan: plan._id,
        plannedDate: date,
        plannedStart: toClock(stop.startMinutes),
        status: "Planned"
      })));
    }

    return ok(plan, 201);
  } catch (error) {
    if (error instanceof PlanError) return badRequest(error.message);
    return fail(error);
  }
}
