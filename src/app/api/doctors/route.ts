import { z } from "zod";
import type { FilterQuery } from "mongoose";
import { connectDb } from "@/lib/db/mongoose";
import { Doctor } from "@/models/Doctor";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { fail, ok, pageParams } from "@/lib/api";
import { callScheduleSchema } from "@/lib/doctors/call-schedule";
import { DOCTOR_LIST_FIELDS } from "@/lib/doctors/fields";

const createSchema = z.object({
  name: z.string().min(2, "Doctor name is required"),
  specialties: z.array(z.string()).default([]),
  clinicName: z.string().optional(),
  phones: z.array(z.string()).default([]),
  email: z.string().optional(),
  fullAddress: z.string().optional(),
  area: z.string().optional(),
  city: z.string().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  priority: z.enum(["Hot", "High", "Medium", "Low"]).default("Medium"),
  stage: z.enum(["New", "Contacted", "Interested", "Prescribing", "Not interested"]).default("New"),
  callSchedule: callScheduleSchema.default([]),
  notes: z.string().optional()
});

export async function GET(request: Request) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    await connectDb();

    const { page, limit, skip, q } = pageParams(request.url);
    const params = new URL(request.url).searchParams;
    const filter: FilterQuery<Record<string, unknown>> = { status: "Active" };

    if (q) {
      const term = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
      filter.$or = [
        { name: term }, { clinicName: term }, { city: term }, { area: term },
        { fullAddress: term }, { phones: term }, { email: term }, { code: term }, { specialties: term }
      ];
    }
    if (params.get("city")) filter.city = params.get("city");
    if (params.get("specialty")) filter.specialties = params.get("specialty");
    if (params.get("priority")) filter.priority = params.get("priority");
    // Route planning only works with a coordinate, so the planner asks for these.
    if (params.get("routable") === "1") filter["location.coordinates"] = { $exists: true, $ne: null };
    if (params.get("weekday")) filter["callSchedule.weekday"] = Number(params.get("weekday"));
    if (params.get("missingCallTime") === "1") filter.callSchedule = { $size: 0 };
    // Field staff only ever see their own doctors.
    if (params.get("mine") === "1") filter.assignedTo = auth.session.userId;

    const [items, total] = await Promise.all([
      Doctor.find(filter).select(DOCTOR_LIST_FIELDS).sort({ name: 1 }).skip(skip).limit(limit).lean(),
      Doctor.countDocuments(filter)
    ]);
    return ok({ items, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await apiSession(can.manageDoctors);
    if ("response" in auth) return auth.response;
    await connectDb();

    const { latitude, longitude, ...value } = createSchema.parse(await request.json());
    const count = await Doctor.estimatedDocumentCount();
    const doctor = await Doctor.create({
      ...value,
      code: `BHX-${String(count + 1).padStart(5, "0")}`,
      source: "Manual",
      ...(latitude !== undefined && longitude !== undefined
        ? { location: { type: "Point", coordinates: [longitude, latitude] } }
        : {})
    });
    return ok(doctor, 201);
  } catch (error) {
    return fail(error);
  }
}
