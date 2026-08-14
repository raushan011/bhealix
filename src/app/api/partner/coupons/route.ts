import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { SalesRep } from "@/models/Sales";
import { apiPartner } from "@/lib/auth/partner";
import { badRequest, fail, ok } from "@/lib/api";
import { recordByRep } from "@/lib/audit";
import { normaliseCode } from "@/lib/sales/coupons";
import { generatedCode, generatedCodeProblem, MAX_COUPONS_PER_REP } from "@/lib/sales/partners";
import { provisionCoupon } from "@/lib/sales/provision";
import { loadSettings, rulesOf } from "@/lib/sales/settings";
import { callerKey, rateLimit, tooManyRequests } from "@/lib/rate-limit";

/**
 * A rep creating their own coupon code.
 *
 * The one place in this application where somebody outside the company causes a
 * discount to exist on the storefront, so it is worth being explicit about what
 * stops that being a hole:
 *
 * 1. **They must be approved.** `mustTrade` refuses a pending, rejected or
 *    suspended account, reading their standing from the database rather than
 *    from a week-old token.
 * 2. **The code must be theirs.** `generatedCodeProblem` requires it to begin
 *    with their own rep code, so nobody can mint `DIWALI30` and collect on the
 *    marketing department's campaign.
 * 3. **The rule must be one the company published.** The rate and the customer
 *    discount are read from settings by suffix; nothing the browser sends
 *    influences either figure.
 * 4. **The discount is the company's, not theirs.** They choose which published
 *    rule to take a code under. They cannot choose what it takes off.
 *
 * The order of operations is deliberate: the code is reserved here first and
 * created in Shopify second. The reverse would leave a live discount on the
 * storefront belonging to nobody whenever the database write failed — and a rep
 * who pressed the button, saw an error and pressed it again would have made two.
 */

const schema = z.object({
  /** Which published rule it pays under. */
  suffix: z.string().trim().regex(/^\d{1,3}$/, "Choose which offer this code is for"),
  /** An optional word of their own between their code and the rule's digits. */
  word: z.string().trim().max(12).optional()
});

export async function POST(request: Request) {
  try {
    const auth = await apiPartner({ mustTrade: true });
    if ("response" in auth) return auth.response;

    // Creating a discount is a write against somebody else's API. Six an hour is
    // far more than the twelve-code lifetime cap needs and stops a stuck button
    // hammering Shopify.
    const limit = rateLimit(callerKey(request, `partner-coupon:${auth.session.repId}`), 6, 60 * 60 * 1000);
    if (!limit.ok) return tooManyRequests(limit.retryAfter, "You have created several codes just now. Please wait a little before creating another.");

    await connectDb();
    const { rep } = auth;
    const input = schema.parse(await request.json());

    const settings = await loadSettings();
    const rule = rulesOf(settings).find(candidate => candidate.suffix === input.suffix && candidate.active);
    if (!rule) return badRequest("That offer is not available. Refresh the page and choose one of the current ones.");

    const repCode = normaliseCode(rep.code ?? "");
    const code = generatedCode(repCode, rule.suffix, input.word ?? "");

    const problem = generatedCodeProblem(code, repCode, rule.suffix);
    if (problem) return badRequest(problem);

    const entry = {
      code,
      suffix: rule.suffix,
      active: true,
      setup: "Awaiting setup",
      issuedBy: "Rep",
      issuedAt: new Date(),
      note: rule.label
    };

    /*
     * Reserved in one atomic update, so two taps on a slow connection cannot
     * both succeed.
     *
     * The filter carries both guards. `coupons.code: { $ne: code }` is the one
     * the unique index cannot provide — MongoDB collapses duplicate keys *within*
     * a single document, so a unique multikey index happily allows the same code
     * twice in one rep's own array. The positional `$exists` check is the cap,
     * expressed as "there is no twelfth element yet" because that is a condition
     * the database can test rather than a count this route would have to read
     * first and act on afterwards.
     */
    let reserved;
    try {
      reserved = await SalesRep.updateOne(
        {
          _id: rep._id,
          "coupons.code": { $ne: code },
          [`coupons.${MAX_COUPONS_PER_REP - 1}`]: { $exists: false }
        },
        { $push: { coupons: entry } }
      );
    } catch (error) {
      // The unique index across `coupons.code` refusing it: somebody else holds
      // this code. Naming them is the administrator's business, not the rep's.
      if (error instanceof Error && error.message.includes("duplicate key")) {
        return badRequest(`The code ${code} is already in use. Add a word of your own to make it different — ${repCode}KIT${rule.suffix}, for instance.`, 409);
      }
      throw error;
    }

    if (!reserved.matchedCount) {
      const existing = (rep.coupons ?? []).find(coupon => normaliseCode(coupon.code ?? "") === code);
      if (existing) {
        return badRequest(existing.active === false
          ? `You already had the code ${code} and it was withdrawn. Ask the company to put it back rather than creating it again — the orders it brought in still point at it.`
          : `You already have the code ${code}.`, 409);
      }
      return badRequest(`You already hold ${MAX_COUPONS_PER_REP} codes, which is the most anybody can have.`, 409);
    }

    await recordByRep({
      rep: String(rep._id),
      action: "sales.coupon.generated",
      entityType: "SalesRep",
      entityId: String(rep._id),
      metadata: { code, suffix: rule.suffix, rule: rule.label }
    });

    /*
     * Now make it real. Never throws — every failure comes back as a state to
     * store, because the reservation above has already happened and a rep must
     * not be shown an error for a code they now hold.
     */
    const outcome = await provisionCoupon({ code, rule, repName: rep.name ?? repCode });

    await SalesRep.updateOne(
      { _id: rep._id, "coupons.code": code },
      {
        $set: {
          "coupons.$.setup": outcome.state,
          ...(outcome.state === "Live"
            ? { "coupons.$.shopifyDiscountId": outcome.shopifyDiscountId }
            : { "coupons.$.setupError": outcome.reason })
        },
        ...(outcome.state === "Live" ? { $unset: { "coupons.$.setupError": "" } } : {})
      }
    );

    await recordByRep({
      rep: String(rep._id),
      action: outcome.state === "Live" ? "sales.coupon.provisioned" : "sales.coupon.setup.failed",
      entityType: "SalesRep",
      entityId: String(rep._id),
      metadata: outcome.state === "Live"
        ? { code, shopifyDiscountId: outcome.shopifyDiscountId }
        : { code, state: outcome.state, reason: outcome.reason }
    });

    return ok({
      coupon: {
        code,
        suffix: rule.suffix,
        active: true,
        setup: outcome.state,
        setupError: outcome.state === "Live" ? undefined : outcome.reason,
        issuedBy: "Rep",
        issuedAt: entry.issuedAt.toISOString()
      },
      /** Whether a customer can use it right now, which is the only thing the rep is really asking. */
      usable: outcome.state === "Live"
    }, 201);
  } catch (error) {
    return fail(error);
  }
}
