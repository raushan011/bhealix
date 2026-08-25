import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { RoutePlan } from "@/models/RoutePlan";
import { Visit } from "@/models/Visit";
import { apiSession } from "@/lib/auth/guard";
import { can, usesFieldPanel } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { buildPlan, planInputSchema, PlanError } from "@/lib/plans";
import { toClock } from "@/lib/time";

const patchSchema = z.object({
  assignedTo: z.string().regex(OBJECT_ID).optional(),
  status: z.enum(["Draft", "Assigned", "In progress", "Completed"]).optional()
});

const rebuildSchema = planInputSchema.extend({
  name: z.string().min(2, "Give the plan a name"),
  assignedTo: z.string().regex(OBJECT_ID).nullable().optional()
});

/**
 * Rebuilds a plan in place with a new day, doctor list or timing.
 *
 * Visits already completed are history and are left alone; only the ones still
 * waiting to happen are rewritten to match the new route, so reworking a draft
 * never erases what a rep has already done.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.planRoutes);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Invalid plan reference");

    await connectDb();
    const plan = await RoutePlan.findById(id);
    if (!plan) return badRequest("Plan not found", 404);

    const input = rebuildSchema.parse(await request.json());
    const { result, weekday } = await buildPlan(input);

    const [year, month, day] = input.date.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    const assignedTo = input.assignedTo === undefined ? plan.assignedTo : input.assignedTo;

    // Assigned directly rather than through `.set()` below: reworking a plan to
    // start from a doctor needs this cleared, and a plain assignment is the
    // reliable way to drop a single nested subdocument on save.
    plan.origin = input.origin.kind !== "doctor" ? {
      kind: input.origin.kind, label: input.origin.label,
      location: { type: "Point", coordinates: [input.origin.longitude, input.origin.latitude] }
    } : undefined;

    plan.set({
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
      assignedTo: assignedTo ?? undefined,
      status: assignedTo ? (plan.status === "Draft" ? "Assigned" : plan.status) : "Draft"
    });
    await plan.save();

    await Visit.deleteMany({ routePlan: plan._id, status: "Planned" });
    if (assignedTo) {
      // Only non-Planned visits remain at this point, so these are the stops a
      // rep has already settled — they keep their existing visit record.
      const done = await Visit.find({ routePlan: plan._id }).select("doctor").lean() as unknown as Array<{ doctor: unknown }>;
      const alreadyVisited = new Set(done.map(visit => String(visit.doctor)));
      const fresh = result.stops.filter(stop => !alreadyVisited.has(stop.id));
      if (fresh.length) {
        await Visit.insertMany(fresh.map(stop => ({
          doctor: stop.id,
          employee: assignedTo,
          routePlan: plan._id,
          plannedDate: date,
          plannedStart: toClock(stop.startMinutes),
          status: "Planned"
        })));
      }
    }

    return ok(plan);
  } catch (error) {
    if (error instanceof PlanError) return badRequest(error.message);
    return fail(error);
  }
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Invalid plan reference");

    await connectDb();
    const plan = await RoutePlan.findById(id)
      .populate("assignedTo", "name employeeId")
      .populate("stops.doctor", "name clinicName area city phones location callSchedule")
      .lean() as { assignedTo?: { _id?: unknown } } | null;
    if (!plan) return badRequest("Plan not found", 404);

    if (usesFieldPanel(auth.session.role) && String(plan.assignedTo?._id ?? "") !== auth.session.userId) {
      return badRequest("This plan is not assigned to you", 403);
    }
    return ok(plan);
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.planRoutes);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Invalid plan reference");

    await connectDb();
    const value = patchSchema.parse(await request.json());
    const plan = await RoutePlan.findById(id);
    if (!plan) return badRequest("Plan not found", 404);

    // Plans written before weekday/startTime existed cannot pass validation on
    // save. Backfill from what the record does have so they stay reassignable.
    if (plan.weekday === undefined || plan.weekday === null) plan.weekday = new Date(plan.date).getDay();
    if (!plan.startTime) plan.startTime = "09:30";
    if (!plan.visitMinutes) plan.visitMinutes = 45;

    if (value.assignedTo) {
      plan.assignedTo = value.assignedTo;
      if (plan.status === "Draft") plan.status = "Assigned";
    }
    if (value.status) plan.status = value.status;

    // Save before touching visits: if the plan cannot be saved, the previous
    // order left freshly created visits behind pointing at an unassigned plan.
    await plan.save();

    // Assigning always rebuilds the rep's outstanding visits, even when the plan
    // already named that person. A plan can say "assigned" while its visits were
    // removed by a rework or a delete, and reassigning is the only way an admin
    // can repair that — making it a no-op left the rep with an empty day.
    if (value.assignedTo) {
      await Visit.deleteMany({ routePlan: plan._id, status: "Planned" });
      const settled = await Visit.find({ routePlan: plan._id }).select("doctor").lean() as unknown as Array<{ doctor: unknown }>;
      const alreadyVisited = new Set(settled.map(visit => String(visit.doctor)));
      const fresh = plan.stops.filter((stop: { doctor: unknown }) => !alreadyVisited.has(String(stop.doctor)));

      if (fresh.length) {
        await Visit.insertMany(fresh.map((stop: { doctor: unknown; plannedStart?: string }) => ({
          doctor: stop.doctor,
          employee: value.assignedTo,
          routePlan: plan._id,
          plannedDate: plan.date,
          plannedStart: stop.plannedStart,
          status: "Planned"
        })));
      }
    }

    return ok(plan);
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.planRoutes);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Invalid plan reference");

    await connectDb();
    const plan = await RoutePlan.findByIdAndDelete(id);
    if (!plan) return badRequest("Plan not found", 404);
    // Completed visits are history and stay; only untouched ones are removed.
    await Visit.deleteMany({ routePlan: id, status: "Planned" });
    return ok({ deleted: true });
  } catch (error) {
    return fail(error);
  }
}
