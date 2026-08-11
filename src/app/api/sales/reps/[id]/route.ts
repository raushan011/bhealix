import { z } from "zod";
import { Types } from "mongoose";
import { connectDb } from "@/lib/db/mongoose";
import { SalesOrder, SalesRep } from "@/models/Sales";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { record } from "@/lib/audit";
import { normaliseCode } from "@/lib/sales/coupons";
import { PAYOUT_MODES } from "@/lib/sales/constants";
import { repSummary } from "@/lib/sales/reporting";

const patchSchema = z.object({
  name: z.string().trim().min(2).optional(),
  phone: z.string().trim().max(20).optional(),
  email: z.email().optional().or(z.literal("")),
  coupons: z.array(z.object({
    code: z.string().trim().min(3).max(32),
    suffix: z.string().trim().regex(/^\d{1,3}$/),
    active: z.boolean().default(true),
    note: z.string().trim().max(120).optional()
  })).max(12).optional(),
  payMethod: z.enum(PAYOUT_MODES).optional(),
  upiId: z.string().trim().max(80).optional(),
  bankName: z.string().trim().max(80).optional(),
  bankAccountName: z.string().trim().max(80).optional(),
  bankAccountNo: z.string().trim().max(32).optional(),
  bankIfsc: z.string().trim().max(16).optional(),
  panNumber: z.string().trim().max(12).optional(),
  joinedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().trim().max(500).optional(),
  active: z.boolean().optional()
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.viewSales);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Not a valid rep id");
    await connectDb();

    const rep = await SalesRep.findById(id).lean();
    if (!rep) return badRequest("No such rep", 404);

    const [summary, orders] = await Promise.all([
      repSummary(id),
      SalesOrder.find({ rep: new Types.ObjectId(id) }).sort({ placedAt: -1 }).limit(200).lean()
    ]);

    return ok({ rep, summary, orders });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.manageSales);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Not a valid rep id");
    await connectDb();

    const input = patchSchema.parse(await request.json());
    const rep = await SalesRep.findById(id);
    if (!rep) return badRequest("No such rep", 404);

    if (input.coupons) {
      // A coupon may be called anything Shopify will accept — the rule it pays
      // under is carried by its `suffix`, not by the letters in the code.
      const coupons = input.coupons.map(coupon => ({ ...coupon, code: normaliseCode(coupon.code) }));

      const duplicate = coupons.find((coupon, at) => coupons.findIndex(other => other.code === coupon.code) !== at);
      if (duplicate) return badRequest(`"${duplicate.code}" is listed twice.`);

      const clash = await SalesRep.findOne({
        _id: { $ne: rep._id },
        "coupons.code": { $in: coupons.map(coupon => coupon.code) }
      }).select("name").lean() as { name?: string } | null;
      if (clash) return badRequest(`${clash.name} already holds one of those codes.`, 409);

      // A code is never dropped outright, only switched off: the orders it
      // already brought in still point at it, and a coupon that vanished would
      // leave them with nothing to explain how they were attributed.
      const withdrawn = (rep.coupons ?? [])
        .filter((existing: { code: string }) => !coupons.some(coupon => coupon.code === existing.code))
        .map((existing: { code: string; suffix: string; note?: string }) => ({ ...existing, active: false }));

      rep.coupons = [...coupons, ...withdrawn];
    }

    for (const [key, value] of Object.entries(input)) {
      if (key === "coupons" || value === undefined) continue;
      rep.set(key, key === "email" ? (value || undefined) : value);
    }

    await rep.save();
    await record({
      actor: auth.session.userId,
      action: input.active === false ? "sales.rep.deactivated" : "sales.rep.updated",
      entityType: "SalesRep",
      entityId: String(rep._id),
      metadata: { code: rep.code }
    });

    return ok({ _id: rep._id });
  } catch (error) {
    return fail(error);
  }
}

/**
 * Deactivates, and deletes outright only where nothing points at them.
 *
 * The same rule the rest of the system uses (§4.10): a rep with attributed
 * orders is part of the record of what was sold and what was paid, and removing
 * them would orphan every order and every payout line that names them.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.manageSales);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Not a valid rep id");
    await connectDb();

    const rep = await SalesRep.findById(id);
    if (!rep) return badRequest("No such rep", 404);

    const orders = await SalesOrder.countDocuments({ rep: rep._id });
    if (orders) {
      rep.active = false;
      await rep.save();
      await record({
        actor: auth.session.userId, action: "sales.rep.deactivated",
        entityType: "SalesRep", entityId: String(rep._id), metadata: { code: rep.code, orders }
      });
      return ok({ deactivated: true, orders, message: `${rep.name} has ${orders} attributed order${orders === 1 ? "" : "s"}, so the record has been deactivated rather than deleted.` });
    }

    await rep.deleteOne();
    await record({
      actor: auth.session.userId, action: "sales.rep.deleted",
      entityType: "SalesRep", entityId: id, metadata: { code: rep.code }
    });
    return ok({ deleted: true });
  } catch (error) {
    return fail(error);
  }
}
