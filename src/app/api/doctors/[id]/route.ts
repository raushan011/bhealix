import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { Doctor } from "@/models/Doctor";
import { Visit } from "@/models/Visit";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { refreshDistancesForDoctor } from "@/lib/plans";

const updateSchema = z.object({
  name: z.string().min(2).optional(),
  specialties: z.array(z.string()).optional(),
  clinicName: z.string().optional(),
  phones: z.array(z.string()).optional(),
  email: z.string().optional(),
  fullAddress: z.string().optional(),
  area: z.string().optional(),
  city: z.string().optional(),
  pinCode: z.string().optional(),
  state: z.string().optional(),
  stateCode: z.string().optional(),
  gstin: z.string().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  priority: z.enum(["Hot", "High", "Medium", "Low"]).optional(),
  stage: z.enum(["New", "Contacted", "Interested", "Prescribing", "Not interested"]).optional(),
  assignedTo: z.string().regex(OBJECT_ID).nullable().optional(),
  notes: z.string().optional()
});

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Invalid doctor reference");

    await connectDb();
    const [doctor, visits] = await Promise.all([
      Doctor.findById(id).populate("assignedTo", "name employeeId").lean(),
      Visit.find({ doctor: id, status: "Completed" }).populate("employee", "name").sort({ checkOutAt: -1 }).limit(10).lean()
    ]);
    if (!doctor) return badRequest("Doctor not found", 404);
    return ok({ doctor, visits });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.manageDoctors);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Invalid doctor reference");

    await connectDb();
    const { latitude, longitude, ...value } = updateSchema.parse(await request.json());
    const update: Record<string, unknown> = { ...value };
    if (latitude !== undefined && longitude !== undefined) {
      update.location = { type: "Point", coordinates: [longitude, latitude] };
    }

    const doctor = await Doctor.findByIdAndUpdate(id, update, { new: true, runValidators: true });
    if (!doctor) return badRequest("Doctor not found", 404);

    // The doctor's own record is right immediately; every plan that already
    // visits them still shows whatever distance was true when it was built,
    // so this brings those figures back in line with where they actually are.
    if (update.location) await refreshDistancesForDoctor(id);

    return ok(doctor);
  } catch (error) {
    return fail(error);
  }
}

/** Archived rather than deleted, so past visit history stays meaningful. */
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.manageDoctors);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Invalid doctor reference");

    await connectDb();
    const doctor = await Doctor.findByIdAndUpdate(id, { status: "Archived" }, { new: true });
    return doctor ? ok({ archived: true }) : badRequest("Doctor not found", 404);
  } catch (error) {
    return fail(error);
  }
}
