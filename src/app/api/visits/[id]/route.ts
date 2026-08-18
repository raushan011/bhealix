import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { Visit } from "@/models/Visit";
import { VisitPhoto } from "@/models/VisitPhoto";
import { INTEREST_LEVELS, VISIT_OUTCOMES } from "@/lib/visits";
import { Doctor } from "@/models/Doctor";
import { RoutePlan } from "@/models/RoutePlan";
import { apiSession } from "@/lib/auth/guard";
import { usesFieldPanel } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { record } from "@/lib/audit";
import { syncDispenseLedger } from "@/lib/samples/ledger";

const checkInSchema = z.object({
  action: z.literal("check-in"),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  accuracy: z.number().positive().optional()
});

/** Everything the rep records about what happened at the call. */
const detailFields = {
  outcome: z.enum(VISIT_OUTCOMES),
  productsDiscussed: z.array(z.string()).default([]),
  samples: z.array(z.object({ product: z.string().min(1), quantity: z.number().int().min(1).max(999) })).default([]),
  interest: z.enum(INTEREST_LEVELS).optional(),
  orderValue: z.number().min(0).optional(),
  notes: z.string().max(1000).default(""),
  followUpDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /**
   * The doctor the call was actually on, when it was not the one the visit was
   * opened against — a rep who picked the wrong name from a list of similar
   * ones, or walked into the practice next door.
   */
  doctor: z.string().regex(OBJECT_ID).optional()
};

const completeSchema = z.object({ action: z.literal("complete"), ...detailFields });

/**
 * The same details, corrected after the visit was closed. A rep re-reading
 * their day finds the wrong outcome ticked, a sample left off or the note
 * half-written; the correction should be a matter of editing, not of asking an
 * administrator to do it for them.
 */
const editSchema = z.object({ action: z.literal("edit"), ...detailFields });

const missedSchema = z.object({ action: z.literal("missed"), notes: z.string().max(500).default("") });

const schema = z.discriminatedUnion("action", [checkInSchema, completeSchema, editSchema, missedSchema]);

type Details = z.infer<typeof completeSchema> | z.infer<typeof editSchema>;
type VisitDocument = InstanceType<typeof Visit>;

/**
 * `lastVisitedAt` on a doctor is the check-out of their most recent completed
 * visit. Recomputed from the visits rather than patched, so a visit moved off a
 * doctor leaves them with the true date rather than a stale one.
 */
async function refreshLastVisited(doctorId: unknown) {
  const latest = await Visit.findOne({ doctor: doctorId, status: "Completed" })
    .sort({ checkOutAt: -1 }).select("checkOutAt").lean() as { checkOutAt?: Date } | null;
  await Doctor.findByIdAndUpdate(doctorId, { lastVisitedAt: latest?.checkOutAt ?? null });
}

/**
 * Moves a visit onto another doctor: the visit itself, the photos taken at it,
 * and the stop in the route plan that produced it, so nothing is left pointing
 * at the doctor the rep did not see. Returns the doctor it was moved from, or
 * null if nothing changed.
 */
async function reassignDoctor(visit: VisitDocument, doctorId: string) {
  const previous = String(visit.doctor);
  if (previous === doctorId) return null;

  const doctor = await Doctor.findById(doctorId).select("_id").lean();
  if (!doctor) throw new Error("That doctor could not be found");

  visit.doctor = doctorId;
  await VisitPhoto.updateMany({ visit: visit._id }, { doctor: doctorId });
  if (visit.routePlan) {
    await RoutePlan.updateOne(
      { _id: visit.routePlan, "stops.doctor": previous },
      { $set: { "stops.$.doctor": doctorId } }
    );
  }
  return previous;
}

/**
 * Applies what the rep recorded, and keeps the doctor's record in step with it.
 * Shared by completing a visit and by correcting one afterwards; the only
 * difference between the two is whether the clock is set on the way through.
 */
async function applyDetails(visit: VisitDocument, input: Details) {
  const movedFrom = input.doctor ? await reassignDoctor(visit, input.doctor) : null;

  visit.status = "Completed";
  visit.checkOutAt ??= new Date();
  visit.checkInAt ??= visit.checkOutAt;
  visit.outcome = input.outcome;
  visit.productsDiscussed = input.productsDiscussed;
  visit.samples = input.samples;
  visit.interest = input.interest;
  visit.orderValue = input.orderValue;
  visit.notes = input.notes;
  visit.followUpDate = input.followUpDate ? new Date(`${input.followUpDate}T00:00:00`) : undefined;
  await visit.save();

  // The samples the rep logged are the only record of stock leaving their
  // hands, so the ledger is written from the visit rather than counted twice.
  await syncDispenseLedger(visit);

  // Keep the doctor record in step with what actually happened in the field.
  const doctorUpdate: Record<string, unknown> = { lastVisitedAt: visit.checkOutAt };
  if (input.interest === "High") doctorUpdate.stage = "Interested";
  else if (input.interest === "Not interested") doctorUpdate.stage = "Not interested";
  else if (input.outcome === "Met doctor") doctorUpdate.stage = "Contacted";
  await Doctor.findByIdAndUpdate(visit.doctor, doctorUpdate);
  if (movedFrom) await refreshLastVisited(movedFrom);

  // Close the plan once nothing is left outstanding.
  if (visit.routePlan) {
    const pending = await Visit.countDocuments({ routePlan: visit.routePlan, status: { $in: ["Planned", "In progress"] } });
    if (!pending) await RoutePlan.findByIdAndUpdate(visit.routePlan, { status: "Completed" });
  }

  return {
    doctor: String(visit.doctor),
    ...(movedFrom ? { movedFrom } : {}),
    outcome: input.outcome,
    interest: input.interest,
    samples: input.samples.reduce((total, sample) => total + sample.quantity, 0),
    orderValue: input.orderValue ?? 0,
    notes: input.notes
  };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Invalid visit reference");

    await connectDb();
    const visit = await Visit.findById(id);
    if (!visit) return badRequest("Visit not found", 404);
    if (usesFieldPanel(auth.session.role) && String(visit.employee) !== auth.session.userId) {
      return badRequest("This visit belongs to another employee", 403);
    }

    const input = schema.parse(await request.json());

    if (input.action === "check-in") {
      visit.checkInAt = new Date();
      visit.status = "In progress";
      if (input.latitude !== undefined && input.longitude !== undefined) {
        visit.checkInLocation = { latitude: input.latitude, longitude: input.longitude, accuracy: input.accuracy };
      }
      await visit.save();
      await RoutePlan.findByIdAndUpdate(visit.routePlan, { status: "In progress" });
      await record({
        actor: auth.session.userId, action: "visit.checked-in", entityType: "Visit", entityId: visit._id,
        metadata: { doctor: String(visit.doctor), located: Boolean(visit.checkInLocation?.latitude) }
      });
      return ok(visit);
    }

    if (input.action === "missed") {
      visit.status = "Missed";
      visit.notes = input.notes;
      visit.checkOutAt = new Date();
      await visit.save();
      // Nothing changed hands after all, so give the stock back to the rep.
      await syncDispenseLedger(visit);
      await record({
        actor: auth.session.userId, action: "visit.missed", entityType: "Visit", entityId: visit._id,
        metadata: { doctor: String(visit.doctor), notes: input.notes }
      });
      return ok(visit);
    }

    if (input.action === "edit") {
      if (visit.status === "Planned") return badRequest("Check in at the clinic before recording what happened");
      const metadata = await applyDetails(visit, input);
      await record({
        actor: auth.session.userId, action: "visit.edited", entityType: "Visit", entityId: visit._id, metadata
      });
      return ok(visit);
    }

    // Completing sets the clock. A visit completed a second time keeps its first
    // check-out — that is a correction, not a later call.
    if (visit.status !== "Completed") visit.checkOutAt = new Date();
    const metadata = await applyDetails(visit, input);
    await record({
      actor: auth.session.userId, action: "visit.completed", entityType: "Visit", entityId: visit._id, metadata
    });
    return ok(visit);
  } catch (error) {
    return fail(error);
  }
}
