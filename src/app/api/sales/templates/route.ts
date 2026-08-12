import { connectDb } from "@/lib/db/mongoose";
import { SalesTemplate } from "@/models/Sales";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { fail, ok } from "@/lib/api";
import { record } from "@/lib/audit";
import { templateSchema } from "@/lib/sales/outreach";

/**
 * Every message anybody has written, newest first.
 *
 * Unpaged. These are counted in tens at the very most — a list long enough to
 * need a page is a list nobody can pick from anyway, and the queue screen loads
 * this to fill a dropdown before it can do anything at all.
 */
export async function GET() {
  try {
    const auth = await apiSession(can.viewSales);
    if ("response" in auth) return auth.response;
    await connectDb();

    const items = await SalesTemplate.find().sort({ updatedAt: -1 }).limit(100).lean();
    return ok({ items });
  } catch (error) {
    return fail(error);
  }
}

/** Writing a new one. */
export async function POST(request: Request) {
  try {
    const auth = await apiSession(can.manageSales);
    if ("response" in auth) return auth.response;
    await connectDb();

    const input = templateSchema.parse(await request.json());
    const template = await SalesTemplate.create({
      ...input,
      createdBy: auth.session.userId,
      updatedBy: auth.session.userId
    });

    await record({
      actor: auth.session.userId,
      action: "sales.template.created",
      entityType: "SalesTemplate",
      entityId: String(template._id),
      metadata: { name: input.name, audience: input.audience }
    });

    return ok(template.toObject(), 201);
  } catch (error) {
    return fail(error);
  }
}
