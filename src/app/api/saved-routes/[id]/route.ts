import { connectDb } from "@/lib/db/mongoose";
import { SavedRoute } from "@/models/SavedRoute";
import { apiSession } from "@/lib/auth/guard";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { savedRouteInputSchema } from "@/lib/saved-routes";

/**
 * A saved list is scoped to whoever created it, on every verb below — the
 * query itself excludes anybody else's, so this doubles as the ownership
 * check without a separate role or capability lookup.
 */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Invalid list reference");

    await connectDb();
    const doc = await SavedRoute.findOne({ _id: id, createdBy: auth.session.userId }).lean();
    if (!doc) return badRequest("Saved list not found", 404);
    return ok(doc);
  } catch (error) {
    return fail(error);
  }
}

/** Renames and/or replaces the stops of a list already saved — editing in place. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Invalid list reference");

    await connectDb();
    const value = savedRouteInputSchema.parse(await request.json());
    const doc = await SavedRoute.findOneAndUpdate(
      { _id: id, createdBy: auth.session.userId }, value, { new: true }
    );
    if (!doc) return badRequest("Saved list not found", 404);
    return ok(doc);
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Invalid list reference");

    await connectDb();
    const doc = await SavedRoute.findOneAndDelete({ _id: id, createdBy: auth.session.userId });
    if (!doc) return badRequest("Saved list not found", 404);
    return ok({ deleted: true });
  } catch (error) {
    return fail(error);
  }
}
