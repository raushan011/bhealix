import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { Doctor } from "@/models/Doctor";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { fail, ok } from "@/lib/api";

const itemSchema = z.object({
  googlePlaceId: z.string().optional(),
  name: z.string().min(2),
  specialty: z.string().default(""),
  clinicName: z.string().default(""),
  phone: z.string().default(""),
  email: z.string().default(""),
  fullAddress: z.string().default(""),
  area: z.string().default(""),
  city: z.string().default(""),
  googleMapsUrl: z.string().default(""),
  rating: z.number().min(0).max(5).optional(),
  reviewCount: z.number().int().min(0).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  source: z.enum(["Google", "Excel", "Manual"]).default("Google")
});

const schema = z.object({ doctors: z.array(itemSchema).min(1).max(500) });

/**
 * Saves a batch of discovered doctors. Existing records are updated rather than
 * duplicated — matched on Google Place ID when present, otherwise on name and
 * address — and an existing call schedule is never overwritten by an import.
 */
export async function POST(request: Request) {
  try {
    // Field staff add doctors one at a time through this same route, so it is
    // gated on adding rather than on managing the directory.
    const auth = await apiSession(can.addDoctors);
    if ("response" in auth) return auth.response;
    const { doctors } = schema.parse(await request.json());
    await connectDb();

    let created = 0, updated = 0;
    const savedIds: string[] = [];
    let sequence = await Doctor.estimatedDocumentCount();

    for (const value of doctors) {
      const match = value.googlePlaceId
        ? { googlePlaceId: value.googlePlaceId }
        : { name: value.name, fullAddress: value.fullAddress };

      const fields: Record<string, unknown> = {
        name: value.name,
        clinicName: value.clinicName || value.name,
        specialties: value.specialty ? [value.specialty] : [],
        phones: value.phone ? [value.phone] : [],
        fullAddress: value.fullAddress,
        area: value.area,
        city: value.city,
        googleMapsUrl: value.googleMapsUrl,
        rating: value.rating,
        reviewCount: value.reviewCount,
        source: value.source
      };
      if (value.email) fields.email = value.email;
      if (value.googlePlaceId) fields.googlePlaceId = value.googlePlaceId;
      if (value.latitude !== undefined && value.longitude !== undefined) {
        fields.location = { type: "Point", coordinates: [value.longitude, value.latitude] };
      }

      const existing = await Doctor.findOne(match);
      if (existing) {
        existing.set(fields);
        await existing.save();
        updated++;
        savedIds.push(String(existing._id));
        continue;
      }

      sequence++;
      const doctor = await Doctor.create({ ...fields, code: `BHX-${String(sequence).padStart(5, "0")}` });
      created++;
      savedIds.push(String(doctor._id));
    }

    return ok({ created, updated, total: doctors.length, savedIds }, 201);
  } catch (error) {
    return fail(error);
  }
}
