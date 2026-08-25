import { z } from "zod";
import { Doctor } from "@/models/Doctor";
import { planRoute, planRouteFromPoint, type RoutableDoctor, type RoutePlanResult } from "@/lib/routing";
import { slotsForWeekday } from "@/lib/doctors/call-schedule";
import { weekdayOf } from "@/lib/time";
import { OBJECT_ID } from "@/lib/api";

/**
 * Where the day begins. A doctor is the common case and the day's first visit
 * at once; the other three are a coordinate with no call time of its own —
 * the day's clock starts at `startTime` and the first real visit is whichever
 * doctor the route reaches first from there.
 */
export const originSchema = z.object({
  kind: z.enum(["doctor", "location", "home", "custom"]),
  doctorId: z.string().regex(OBJECT_ID).optional(),
  label: z.string().trim().min(1).max(80).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional()
}).superRefine((value, ctx) => {
  if (value.kind === "doctor") {
    if (!value.doctorId) ctx.addIssue({ code: "custom", message: "Choose the starting doctor" });
  } else if (value.latitude === undefined || value.longitude === undefined) {
    ctx.addIssue({ code: "custom", message: "This starting point has no location" });
  }
});

export type PlanOrigin = z.infer<typeof originSchema>;

export const planInputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a visit date"),
  origin: originSchema,
  doctorIds: z.array(z.string().regex(OBJECT_ID)).min(1, "Add at least one doctor").max(40),
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
 * each doctor's call window first and travel distance second — starting from
 * whichever doctor, home, or place the plan names.
 */
export async function buildPlan(input: PlanInput): Promise<{ result: RoutePlanResult; doctors: DoctorLite[]; weekday: number }> {
  if (input.origin.kind === "doctor" && !input.doctorIds.includes(input.origin.doctorId!)) {
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

  const result = input.origin.kind === "doctor"
    ? planRoute(routable, input.origin.doctorId!, { startTime: input.startTime, visitMinutes: input.visitMinutes })
    : planRouteFromPoint(routable, { latitude: input.origin.latitude!, longitude: input.origin.longitude! },
      { startTime: input.startTime, visitMinutes: input.visitMinutes });

  return { result, doctors, weekday };
}
