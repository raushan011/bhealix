import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { RoutePlan } from "@/models/RoutePlan";
import { Visit } from "@/models/Visit";
import { apiSession } from "@/lib/auth/guard";
import { can, usesFieldPanel } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";

const patchSchema = z.object({
  assignedTo: z.string().regex(OBJECT_ID).optional(),
  status: z.enum(["Draft", "Assigned", "In progress", "Completed"]).optional()
});

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

    const reassigning = Boolean(value.assignedTo) && String(plan.assignedTo ?? "") !== value.assignedTo;
    if (reassigning) {
      plan.assignedTo = value.assignedTo;
      if (plan.status === "Draft") plan.status = "Assigned";
    }
    if (value.status) plan.status = value.status;

    // Save before touching visits: if the plan cannot be saved, the previous
    // order left freshly created visits behind pointing at an unassigned plan.
    await plan.save();

    if (reassigning) {
      await Visit.deleteMany({ routePlan: plan._id, status: "Planned" });
      await Visit.insertMany(plan.stops.map((stop: { doctor: unknown; plannedStart?: string }) => ({
        doctor: stop.doctor,
        employee: value.assignedTo,
        routePlan: plan._id,
        plannedDate: plan.date,
        plannedStart: stop.plannedStart,
        status: "Planned"
      })));
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
