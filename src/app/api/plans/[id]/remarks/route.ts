import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { RoutePlan } from "@/models/RoutePlan";
import { apiSession } from "@/lib/auth/guard";
import { can, usesFieldPanel } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";

const schema = z.object({
  doctorId: z.string().regex(OBJECT_ID),
  remarks: z.string().trim().max(500, "Keep the remark under 500 characters")
});

/**
 * Saves the remark on one clinic of a route. The office may write on any plan;
 * a rep only on a plan assigned to them.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Invalid plan reference");

    const own = usesFieldPanel(auth.session.role);
    if (!own && !can.planRoutes(auth.session.role)) return badRequest("You do not have access to this action", 403);

    const { doctorId, remarks } = schema.parse(await request.json());
    await connectDb();

    const filter = { _id: id, "stops.doctor": doctorId, ...(own ? { assignedTo: auth.session.userId } : {}) };
    // updateOne, not save(): older plans lack fields that full validation requires.
    const result = await RoutePlan.updateOne(filter, { $set: { "stops.$.remarks": remarks } });
    if (!result.matchedCount) return badRequest("Plan or clinic not found", 404);
    return ok({ saved: true });
  } catch (error) {
    return fail(error);
  }
}
