import { z } from "zod";
import { Doctor } from "@/models/Doctor";
import { planRoute, type RoutableDoctor, type RoutePlanResult } from "@/lib/routing";
import { slotsForWeekday } from "@/lib/doctors/call-schedule";
import { weekdayOf } from "@/lib/time";
import { OBJECT_ID } from "@/lib/api";

export const planInputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a visit date"),
  referenceDoctorId: z.string().regex(OBJECT_ID),
  doctorIds: z.array(z.string().regex(OBJECT_ID)).min(2, "Add at least two doctors").max(40),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default("09:30"),
  visitMinutes: z.number().int().min(10).max(180).default(45)
});

export type PlanInput = z.infer<typeof planInputSchema>;

export type DoctorLite = {
  _id: unknown; name: string; clinicName?: string; area?: string; city?: string;
  phones?: string[]; location?: { coordinates?: number[] };
  callSchedule?: Array<{ weekday: number; slots: Array<{ start: string; end: string }>; appointmentRequired?: boolean }>;
};

export class PlanError extends Error {}

/**
 * Loads the chosen doctors and orders them for the planned weekday, honouring
 * each doctor's call window first and travel distance second.
 */
export async function buildPlan(input: PlanInput): Promise<{ result: RoutePlanResult; doctors: DoctorLite[]; weekday: number }> {
  if (!input.doctorIds.includes(input.referenceDoctorId)) {
    throw new PlanError("The starting doctor must also be in the visit list");
  }

  const doctors = await Doctor.find({ _id: { $in: input.doctorIds } })
    .select("name clinicName area city phones location callSchedule").lean() as unknown as DoctorLite[];

  if (doctors.length !== input.doctorIds.length) {
    throw new PlanError("Some selected doctors could not be found");
  }

  const missingLocation = doctors.filter(doctor => (doctor.location?.coordinates?.length ?? 0) !== 2);
  if (missingLocation.length) {
    throw new PlanError(`These doctors have no saved location: ${missingLocation.map(d => d.name).join(", ")}`);
  }

  const weekday = weekdayOf(input.date);
  const routable: RoutableDoctor[] = doctors.map(doctor => ({
    id: String(doctor._id),
    name: doctor.name,
    longitude: doctor.location!.coordinates![0],
    latitude: doctor.location!.coordinates![1],
    slots: slotsForWeekday(doctor.callSchedule as never, weekday),
    appointmentRequired: doctor.callSchedule?.find(w => w.weekday === weekday)?.appointmentRequired
  }));

  const result = planRoute(routable, input.referenceDoctorId, {
    startTime: input.startTime,
    visitMinutes: input.visitMinutes
  });

  return { result, doctors, weekday };
}
