import { z } from "zod";
import type { FilterQuery } from "mongoose";
import { connectDb } from "@/lib/db/mongoose";
import { Visit } from "@/models/Visit";
import { Doctor } from "@/models/Doctor";
import { apiSession } from "@/lib/auth/guard";
import { usesFieldPanel } from "@/constants/access";
import { badRequest, fail, ok, pageParams, OBJECT_ID } from "@/lib/api";
import { record } from "@/lib/audit";
import { completeFix } from "@/lib/geo";

export async function GET(request: Request) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    await connectDb();

    const { page, limit, skip } = pageParams(request.url);
    const params = new URL(request.url).searchParams;
    const filter: FilterQuery<Record<string, unknown>> = {};

    // A rep can never widen this to somebody else's visits.
    if (usesFieldPanel(auth.session.role)) filter.employee = auth.session.userId;
    else if (params.get("employee")) filter.employee = params.get("employee");

    if (params.get("doctor")) filter.doctor = params.get("doctor");
    if (params.get("status")) filter.status = params.get("status");

    const from = params.get("from"), to = params.get("to");
    if (from || to) {
      const range: Record<string, Date> = {};
      if (from) range.$gte = new Date(`${from}T00:00:00`);
      if (to) range.$lte = new Date(`${to}T23:59:59`);
      filter.plannedDate = range;
    }

    const [items, total] = await Promise.all([
      Visit.find(filter)
        .populate("doctor", "name clinicName area city phones")
        .populate("employee", "name employeeId")
        .sort({ plannedDate: -1, plannedStart: 1 })
        .skip(skip).limit(limit).lean(),
      Visit.countDocuments(filter)
    ]);
    return ok({ items, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  } catch (error) {
    return fail(error);
  }
}

const registerSchema = z.object({
  doctor: z.string().regex(OBJECT_ID, "Choose the doctor you are visiting"),
  notes: z.string().max(1000).default(""),
  /** Where the rep is standing, so an unplanned call is checked in on the spot. */
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  accuracy: z.number().min(0).optional()
});

/**
 * Registers a call the plan did not contain.
 *
 * A route plan covers the day somebody sat down and worked out. The field is
 * not that: a rep passes a clinic, is called in by a doctor they met last week,
 * or walks into a practice nobody has recorded yet. Until now none of it could
 * be entered, so it either went unrecorded — and the day's work looked thinner
 * than it was — or it was written into whatever planned visit was nearest,
 * which is worse.
 *
 * The visit is created for today and checked in immediately, because the rep is
 * standing at the clinic as they press it; there is no interval in which it
 * makes sense to have registered the call but not arrived. It carries no route
 * plan, which is what makes it an unplanned one wherever it is read.
 *
 * Registering the same doctor twice in a day returns the visit already open
 * rather than a second one. Two taps on a phone with a slow connection is the
 * ordinary way that happens, and a duplicated call would overstate the day.
 */
export async function POST(request: Request) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    if (!usesFieldPanel(auth.session.role)) {
      return badRequest("Only field staff register their own visits", 403);
    }

    const input = registerSchema.parse(await request.json());
    await connectDb();

    const doctor = await Doctor.findById(input.doctor).select("name").lean() as
      { _id: unknown; name?: string } | null;
    if (!doctor) return badRequest("That doctor could not be found", 404);

    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(); end.setHours(23, 59, 59, 999);

    const existing = await Visit.findOne({
      employee: auth.session.userId, doctor: input.doctor,
      plannedDate: { $gte: start, $lte: end }
    }).select("_id status").lean() as { _id: unknown; status: string } | null;

    if (existing) {
      return ok({
        _id: existing._id,
        existing: true,
        message: `You already have a visit to ${doctor.name ?? "this doctor"} today.`
      });
    }

    const now = new Date();
    const fix = completeFix(input);
    const visit = await Visit.create({
      doctor: input.doctor,
      employee: auth.session.userId,
      plannedDate: now,
      plannedStart: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
      status: "In progress",
      checkInAt: now,
      ...(fix ? { checkInLocation: fix } : {}),
      notes: input.notes
    });

    await record({
      actor: auth.session.userId, action: "visit.registered", entityType: "Visit", entityId: visit._id,
      metadata: { doctor: String(input.doctor), located: Boolean(fix) }
    });

    return ok({ _id: visit._id, existing: false }, 201);
  } catch (error) {
    return fail(error);
  }
}
