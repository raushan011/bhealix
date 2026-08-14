import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { SalesRep } from "@/models/Sales";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { record, type AuditAction } from "@/lib/audit";
import { couponSetupOf, repStatusOf } from "@/lib/sales/partners";
import { deactivateCoupon } from "@/lib/sales/provision";

/**
 * Letting somebody in, turning them away, or putting them out again.
 *
 * Its own route rather than a field on the rep's PATCH, because this is the
 * decision the whole self-registration feature rests on. A stranger who fills in
 * the public form gets a record and nothing else; *this* is what turns that
 * record into somebody who can mint a coupon and be paid. Kept separate so it
 * has its own permission (`manageSales`, the administrator alone), its own audit
 * line, and no chance of being made by accident as part of an unrelated edit.
 *
 * Suspension carries the one piece of work nobody would think to do by hand:
 * switching the rep's codes off in Shopify. Marking them inactive here only
 * stops *this* system attributing new orders — the discount itself would keep
 * working on the storefront, taking money off every order and crediting nobody.
 */

const schema = z.object({
  action: z.enum(["approve", "reject", "suspend", "reinstate"]),
  /** Shown to the rep, so it is written to be read by them. */
  note: z.string().trim().max(400).optional()
});

const AUDIT: Record<z.infer<typeof schema>["action"], AuditAction> = {
  approve: "sales.rep.approved",
  reject: "sales.rep.rejected",
  suspend: "sales.rep.suspended",
  reinstate: "sales.rep.reinstated"
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.manageSales);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Not a valid partner id");
    await connectDb();

    const input = schema.parse(await request.json());
    const rep = await SalesRep.findById(id);
    if (!rep) return badRequest("No such partner", 404);

    const before = repStatusOf(rep);

    if (input.action === "reject" && before !== "Pending") {
      return badRequest("Only an application still waiting can be turned down. Suspend the account instead.");
    }
    if (input.action === "reinstate" && before !== "Suspended" && before !== "Rejected") {
      return badRequest("That account is not suspended.");
    }

    /*
     * Codes are switched off in Shopify *before* the status is written.
     *
     * If the shop call fails the suspension still goes through — a decision to
     * put somebody out must not depend on a third party answering — but the
     * failure is reported back, because a suspended rep whose discount is still
     * live on the storefront is a hole somebody has to close by hand.
     */
    const shopProblems: string[] = [];
    if (input.action === "suspend") {
      for (const coupon of rep.coupons ?? []) {
        if (coupon.active === false || couponSetupOf(coupon) !== "Live" || !coupon.shopifyDiscountId) continue;
        const result = await deactivateCoupon(coupon.shopifyDiscountId);
        if (!result.ok) shopProblems.push(`${coupon.code}: ${result.reason}`);
      }
    }

    switch (input.action) {
      case "approve":
        rep.status = "Active";
        rep.active = true;
        rep.approvedBy = auth.session.userId;
        rep.approvedAt = new Date();
        rep.reviewNote = input.note;
        break;
      case "reject":
        rep.status = "Rejected";
        rep.active = false;
        rep.reviewNote = input.note;
        break;
      case "suspend":
        rep.status = "Suspended";
        // Their codes stop attributing new orders as well as stopping working.
        // Everything already earned is untouched — it was earned.
        rep.active = false;
        rep.reviewNote = input.note;
        break;
      case "reinstate":
        rep.status = "Active";
        rep.active = true;
        rep.reviewNote = undefined;
        break;
    }

    await rep.save();

    await record({
      actor: auth.session.userId,
      action: AUDIT[input.action],
      entityType: "SalesRep",
      entityId: String(rep._id),
      metadata: { code: rep.code, from: before, note: input.note, shopProblems: shopProblems.length || undefined }
    });

    const message = {
      approve: `${rep.name} can now create their own coupon codes and start earning.`,
      reject: `${rep.name}'s application has been turned down. They can no longer sign in.`,
      suspend: `${rep.name} has been suspended. Anything already earned is unaffected.`,
      reinstate: `${rep.name} is active again.`
    }[input.action];

    return ok({
      status: repStatusOf(rep),
      message,
      /*
       * Reported rather than buried. A code that could not be switched off in
       * Shopify is still discounting orders for a rep who has been suspended —
       * the one consequence of this action that the screen cannot show by
       * redrawing the row.
       */
      shopProblems
    });
  } catch (error) {
    return fail(error);
  }
}
