import { connectDb } from "@/lib/db/mongoose";
import { SavedRoute } from "@/models/SavedRoute";
import { apiSession } from "@/lib/auth/guard";
import { fail, ok } from "@/lib/api";
import { savedRouteInputSchema } from "@/lib/saved-routes";

/**
 * A person's own saved distance-finder lists, newest first.
 *
 * Available to any signed-in session — admin or MR — with no capability
 * check: this is personal, disposable data, not something the directory or
 * anybody else's round depends on, so ownership alone is the whole rule.
 */
export async function GET() {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    await connectDb();

    const items = await SavedRoute.find({ createdBy: auth.session.userId })
      .select("name sortMode points updatedAt")
      .sort({ updatedAt: -1 })
      .lean() as unknown as Array<{ _id: unknown; name: string; sortMode: string; points?: unknown[]; updatedAt: Date }>;

    return ok({ items: items.map(item => ({
      _id: item._id, name: item.name, sortMode: item.sortMode,
      stops: item.points?.length ?? 0, updatedAt: item.updatedAt
    })) });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    await connectDb();

    const value = savedRouteInputSchema.parse(await request.json());
    const doc = await SavedRoute.create({ ...value, createdBy: auth.session.userId });
    return ok(doc, 201);
  } catch (error) {
    return fail(error);
  }
}
