import { connectDb } from "@/lib/db/mongoose";
import { VisitPhoto } from "@/models/VisitPhoto";
import { apiSession } from "@/lib/auth/guard";
import { usesFieldPanel } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { record } from "@/lib/audit";

const EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"
};

/**
 * Serves one photograph.
 *
 * The bytes never go out through a public URL — this route is behind the same
 * session as everything else, and a rep only ever gets their own. Expired
 * photos are treated as gone the moment they expire rather than when MongoDB's
 * sweep next runs.
 *
 * Cached privately for an hour: an image is immutable once written, and a page
 * showing eight of them should not refetch all eight on every visit to it.
 */
export async function GET(_: Request, { params }: { params: Promise<{ id: string; photoId: string }> }) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    const { id, photoId } = await params;
    if (!OBJECT_ID.test(id) || !OBJECT_ID.test(photoId)) return badRequest("Invalid photo reference");

    await connectDb();
    const photo = await VisitPhoto.findOne({ _id: photoId, visit: id, expiresAt: { $gt: new Date() } })
      .select("+data contentType employee createdAt").lean() as
      { data?: Buffer; contentType: string; employee: unknown } | null;

    if (!photo?.data) return badRequest("This photo is no longer available", 404);
    if (usesFieldPanel(auth.session.role) && String(photo.employee) !== auth.session.userId) {
      return badRequest("This photo belongs to another employee", 403);
    }

    const bytes = new Uint8Array(photo.data);
    return new Response(bytes, {
      headers: {
        "content-type": photo.contentType,
        "content-length": String(bytes.byteLength),
        "content-disposition": `inline; filename="visit-${photoId}.${EXTENSION[photo.contentType] ?? "jpg"}"`,
        "cache-control": "private, max-age=3600"
      }
    });
  } catch (error) {
    return fail(error);
  }
}

/**
 * Removes a photo early. The rep who took it can withdraw one attached by
 * mistake, and an administrator can remove any of them; everything left goes by
 * itself at thirty days.
 */
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string; photoId: string }> }) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    const { id, photoId } = await params;
    if (!OBJECT_ID.test(id) || !OBJECT_ID.test(photoId)) return badRequest("Invalid photo reference");

    await connectDb();
    const photo = await VisitPhoto.findOne({ _id: photoId, visit: id }).select("employee").lean() as
      { employee: unknown } | null;
    if (!photo) return badRequest("This photo is no longer available", 404);

    const owner = String(photo.employee) === auth.session.userId;
    if (!owner && auth.session.role !== "ADMIN") {
      return badRequest("Only the representative who took this photo, or an administrator, can remove it", 403);
    }

    await VisitPhoto.deleteOne({ _id: photoId });
    await record({
      actor: auth.session.userId, action: "visit.photo.deleted",
      entityType: "Visit", entityId: id, metadata: { photo: photoId, own: owner }
    });

    return ok({ deleted: true });
  } catch (error) {
    return fail(error);
  }
}
