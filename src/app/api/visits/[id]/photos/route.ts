import { connectDb } from "@/lib/db/mongoose";
import { Visit } from "@/models/Visit";
import { VisitPhoto } from "@/models/VisitPhoto";
import { apiSession } from "@/lib/auth/guard";
import { usesFieldPanel, type Role } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { record } from "@/lib/audit";
import {
  MAX_PHOTOS_PER_VISIT, MAX_PHOTO_BYTES, PHOTO_RETENTION_DAYS, PHOTO_TYPES, photoExpiryFrom
} from "@/lib/visits";
import { completeFix } from "@/lib/geo";

const ACCEPTED: readonly string[] = PHOTO_TYPES;
const METADATA = "contentType bytes caption location createdAt expiresAt employee";

/**
 * The fix the phone reported when the photos were taken, as posted with them.
 *
 * A photo without one is still accepted — a rep in a basement clinic with no
 * signal must not be stopped from recording the call — but a half fix, or a
 * coordinate off the globe, is dropped rather than stored, so nothing that
 * reads this back has to wonder whether it means anything.
 */
function fixFrom(form: FormData) {
  const fix = completeFix({
    latitude: Number(form.get("latitude")),
    longitude: Number(form.get("longitude")),
    accuracy: Number(form.get("accuracy"))
  });
  if (!fix) return undefined;

  const text = (field: string, limit: number) => String(form.get(field) ?? "").trim().slice(0, limit);
  return { ...fix, address: text("address", 250), area: text("area", 120), city: text("city", 120) };
}

/** Photos a rep can only ever reach on their own visit; the desk reads any of them. */
async function reachable(id: string, session: { role: Role; userId: string }) {
  const visit = await Visit.findById(id).select("employee doctor status").lean() as
    { _id: unknown; employee: unknown; doctor?: unknown; status: string } | null;
  if (!visit) return { error: badRequest("Visit not found", 404) };
  if (usesFieldPanel(session.role) && String(visit.employee) !== session.userId) {
    return { error: badRequest("This visit belongs to another employee", 403) };
  }
  return { visit };
}

/**
 * The photos still held for a visit — metadata only, so nothing here carries
 * image bytes. Anything already past its thirty days is excluded rather than
 * waited on: MongoDB's TTL sweep runs about once a minute, and a photo that has
 * expired should stop being visible the moment it expires.
 */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Invalid visit reference");

    await connectDb();
    const found = await reachable(id, auth.session);
    if ("error" in found) return found.error;

    const items = await VisitPhoto.find({ visit: id, expiresAt: { $gt: new Date() } })
      .select(METADATA).sort({ createdAt: 1 }).lean();

    return ok({ items, retentionDays: PHOTO_RETENTION_DAYS, max: MAX_PHOTOS_PER_VISIT });
  } catch (error) {
    return fail(error);
  }
}

/**
 * Attaches photographs taken at the call.
 *
 * Only the rep whose visit it is may add one, and only once they have checked
 * in — a photo uploaded before arriving proves nothing about the call. The
 * phone downscales before sending, so the ceiling here is a backstop against a
 * raw camera file rather than the normal path.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    if (!usesFieldPanel(auth.session.role)) {
      return badRequest("Only field staff attach photos to a visit", 403);
    }
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Invalid visit reference");

    await connectDb();
    const found = await reachable(id, auth.session);
    if ("error" in found) return found.error;
    const { visit } = found;
    if (visit.status === "Planned") return badRequest("Check in at the clinic before adding photos");

    const form = await request.formData();
    const files = form.getAll("photo").filter((entry): entry is File =>
      typeof entry === "object" && entry !== null && typeof (entry as File).arrayBuffer === "function");
    if (!files.length) return badRequest("Choose at least one photo");

    const caption = String(form.get("caption") ?? "").trim().slice(0, 200);
    const location = fixFrom(form);
    const now = new Date();
    const held = await VisitPhoto.countDocuments({ visit: id, expiresAt: { $gt: now } });
    if (held + files.length > MAX_PHOTOS_PER_VISIT) {
      return badRequest(`A visit holds at most ${MAX_PHOTOS_PER_VISIT} photos — ${held} already attached`);
    }

    // Every file is checked before any is written, so a rejected second photo
    // cannot leave the first one saved and the rep unsure what got through.
    const prepared: Array<{ data: Buffer; contentType: string; bytes: number }> = [];
    for (const file of files) {
      if (!ACCEPTED.includes(file.type)) return badRequest("Photos must be JPEG, PNG or WebP");
      if (file.size > MAX_PHOTO_BYTES) {
        return badRequest(`Each photo must be under ${Math.round(MAX_PHOTO_BYTES / (1024 * 1024))} MB`);
      }
      const data = Buffer.from(await file.arrayBuffer());
      if (!data.length) return badRequest("That photo came through empty — try taking it again");
      prepared.push({ data, contentType: file.type, bytes: data.length });
    }

    const expiresAt = photoExpiryFrom(now);
    const saved = await VisitPhoto.insertMany(prepared.map(photo => ({
      ...photo, visit: id, doctor: visit.doctor, employee: auth.session.userId,
      caption, location, expiresAt
    })));

    await record({
      actor: auth.session.userId,
      action: "visit.photo.added",
      entityType: "Visit",
      entityId: visit._id,
      // Whether the photos carried a position is worth keeping even though the
      // photos themselves go in thirty days: an unlocated call is exactly the
      // thing somebody asks about later, once the picture is gone.
      metadata: {
        count: saved.length,
        doctor: visit.doctor ? String(visit.doctor) : undefined,
        located: Boolean(location),
        ...(location ? { at: `${location.latitude},${location.longitude}` } : {})
      }
    });

    return ok({
      items: saved.map(photo => ({
        _id: photo._id, contentType: photo.contentType, bytes: photo.bytes,
        // `location` rather than `photo.location`: every photo in a batch was
        // taken at the same spot, and Mongoose hands back an empty nested
        // object for an unset one, which reads as located when it is not.
        caption: photo.caption, location,
        createdAt: photo.createdAt, expiresAt: photo.expiresAt
      })),
      retentionDays: PHOTO_RETENTION_DAYS
    }, 201);
  } catch (error) {
    return fail(error);
  }
}
