import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { Doctor } from "@/models/Doctor";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { record } from "@/lib/audit";
import { callScheduleSchema } from "@/lib/doctors/call-schedule";

const schema = z.object({ callSchedule: callScheduleSchema });

/**
 * Replaces a doctor's weekly call timing.
 *
 * Field staff are allowed here on purpose: a rep who has just spoken to the
 * doctor knows the real timing better than the record does, and stale call
 * times are what make a route plan useless.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.updateCallTime);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Invalid doctor reference");

    const { callSchedule } = schema.parse(await request.json());
    await connectDb();

    const now = new Date();
    const doctor = await Doctor.findByIdAndUpdate(id, {
      callSchedule: callSchedule.map(window => ({ ...window, updatedBy: auth.session.userId, updatedAt: now })),
      callTimeVerifiedAt: now
    }, { new: true, runValidators: true }).select("name callSchedule callTimeVerifiedAt");

    if (!doctor) return badRequest("Doctor not found", 404);

    await record({
      actor: auth.session.userId,
      action: "doctor.call-schedule.updated",
      entityType: "Doctor",
      entityId: doctor._id,
      metadata: { name: doctor.name, days: callSchedule.map(w => w.weekday) }
    });

    return ok(doctor);
  } catch (error) {
    return fail(error);
  }
}
