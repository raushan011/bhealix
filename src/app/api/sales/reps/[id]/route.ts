import { z } from "zod";
import { Types } from "mongoose";
import { connectDb } from "@/lib/db/mongoose";
import { SalesOrder, SalesPayoutLine, SalesRep } from "@/models/Sales";
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
    if (!OBJECT_ID.test(id)) return badRequest("Not a valid partner id");
    await connectDb();

    // `+passwordHash` only to answer "can this person sign in"; it is stripped
    // below and never reaches a browser.
    const rep = await SalesRep.findById(id).select("+passwordHash").lean() as { passwordHash?: string } | null;
    if (!rep) return badRequest("No such partner", 404);

    const repId = new Types.ObjectId(id);
    const [summary, orders, orderCount, payoutLines] = await Promise.all([
      repSummary(id),
      SalesOrder.find({ rep: repId }).sort({ placedAt: -1 }).limit(200).lean(),
      // The list above is capped at 200; deleting somebody has to warn about all
      // of them, so the true count is asked for separately.
      SalesOrder.countDocuments({ rep: repId }),
      SalesPayoutLine.countDocuments({ rep: repId })
    ]);

    const { passwordHash, ...safe } = rep;
    return ok({
      rep: { ...safe, hasLogin: Boolean(passwordHash) },
      summary,
      orders,
      /** What a permanent delete would touch — read by the confirmation screen. */
      attached: { orders: orderCount, payoutLines }
    });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.manageSales);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Not a valid partner id");
    await connectDb();

    const input = patchSchema.parse(await request.json());
    const rep = await SalesRep.findById(id);
    if (!rep) return badRequest("No such partner", 404);

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
 * Removing a partner: deactivating by default, deleting outright on request.
 *
 * Two different acts, and the default is the gentle one. Plain `DELETE`
 * deactivates anybody who has brought in an order — their codes stop
 * attributing, their record stays. `?permanent=1` erases the record itself, and
 * is what an administrator asks for when somebody was entered by mistake or has
 * asked to be removed altogether.
 *
 * **What a permanent delete must never do is quietly damage the books**, and
 * that is what the snapshotting below is for. A deleted partner leaves behind
 * orders that reference them and payout lines that paid them:
 *
 *   - **Payout lines already survive**, by design. Each one copies the
 *     partner's name, code and payment details onto itself when the run is
 *     generated (§4.5), precisely so an advice can be read years later without
 *     the record it was made from. Nothing to do.
 *   - **Orders do not**, so their partner is written onto them here before the
 *     record goes. Without it, a year of revenue would read as having been
 *     brought in by nobody, and the coupon column would be the only clue left.
 *
 * The commission figures on those orders are untouched. What was earned was
 * earned, and a payout run that has already paid it is evidence of a payment
 * that really happened — deleting the person does not unmake either.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.manageSales);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Not a valid partner id");
    await connectDb();

    const url = new URL(request.url);
    const permanent = url.searchParams.get("permanent") === "1";

    const rep = await SalesRep.findById(id);
    if (!rep) return badRequest("No such partner", 404);

    const [orders, payoutLines] = await Promise.all([
      SalesOrder.countDocuments({ rep: rep._id }),
      SalesPayoutLine.countDocuments({ rep: rep._id })
    ]);

    if (!permanent && orders) {
      rep.active = false;
      await rep.save();
      await record({
        actor: auth.session.userId, action: "sales.rep.deactivated",
        entityType: "SalesRep", entityId: String(rep._id), metadata: { code: rep.code, orders }
      });
      return ok({
        deactivated: true, orders,
        message: `${rep.name} has ${orders} attributed order${orders === 1 ? "" : "s"}, so the record has been deactivated rather than deleted. Delete it permanently if you meant to remove them altogether.`
      });
    }

    if (permanent) {
      /*
       * Typing the partner's own code is the confirmation.
       *
       * A checkbox is dismissed without being read; retyping RAUSHAN cannot be
       * done by accident, and it is checked on the server as well as in the
       * browser, because a confirmation that only the browser enforces is not a
       * confirmation at all.
       */
      const confirm = normaliseCode(url.searchParams.get("confirm") ?? "");
      if (confirm !== normaliseCode(rep.code)) {
        return badRequest(`To delete this record permanently, confirm with the partner's code — ${rep.code}.`);
      }

      if (orders) {
        await SalesOrder.updateMany(
          { rep: rep._id },
          {
            $set: {
              "repSnapshot.name": rep.name,
              "repSnapshot.code": rep.code,
              "repSnapshot.deletedAt": new Date()
            },
            // The reference is cleared as the record goes, so nothing is left
            // pointing at an id that no longer resolves.
            $unset: { rep: "" }
          }
        );
      }

      await rep.deleteOne();
      await record({
        actor: auth.session.userId, action: "sales.rep.deleted",
        entityType: "SalesRep", entityId: id,
        metadata: { code: rep.code, name: rep.name, orders, payoutLines, permanent: true }
      });

      return ok({
        deleted: true, orders, payoutLines,
        message: orders
          ? `${rep.name} has been deleted. Their ${orders} order${orders === 1 ? "" : "s"} ${orders === 1 ? "keeps" : "keep"} their name and coupon code so the revenue still reads correctly, and any payout advice already issued is unchanged.`
          : `${rep.name} has been deleted.`
      });
    }

    // Nothing points at them and nothing was asked for beyond removal.
    await rep.deleteOne();
    await record({
      actor: auth.session.userId, action: "sales.rep.deleted",
      entityType: "SalesRep", entityId: id, metadata: { code: rep.code }
    });
    return ok({ deleted: true, message: `${rep.name} has been deleted.` });
  } catch (error) {
    return fail(error);
  }
}
