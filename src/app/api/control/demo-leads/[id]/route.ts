import { connectDb } from "@/lib/db/mongoose";
import { DemoLead } from "@/models/DemoLead";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { demoLeadUpdateSchema } from "@/lib/demo-leads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** Move a request along, or write down what was said. */
export async function PATCH(request: Request, { params }: Context) {
  try {
    const auth = await apiSession(can.manageDemoLeads);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("That request does not exist", 404);

    const input = demoLeadUpdateSchema.parse(await request.json());
    await connectDb();
    const lead = await DemoLead.findByIdAndUpdate(id, { $set: input }, { new: true, runValidators: true }).lean();
    if (!lead) return badRequest("That request does not exist", 404);
    return ok(lead);
  } catch (error) {
    return fail(error);
  }
}

/** Spam, duplicates and tests. A real prospect is marked Lost, not removed. */
export async function DELETE(_request: Request, { params }: Context) {
  try {
    const auth = await apiSession(can.manageDemoLeads);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("That request does not exist", 404);

    await connectDb();
    const removed = await DemoLead.findByIdAndDelete(id).lean();
    if (!removed) return badRequest("That request does not exist", 404);
    return ok({ deleted: true });
  } catch (error) {
    return fail(error);
  }
}
