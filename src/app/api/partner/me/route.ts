import { connectDb } from "@/lib/db/mongoose";
import { apiPartner } from "@/lib/auth/partner";
import { fail, ok } from "@/lib/api";
import { normaliseCode } from "@/lib/sales/coupons";
import { couponSetupOf, MAX_COUPONS_PER_REP, refusalFor, repStatusOf } from "@/lib/sales/partners";
import { customerDiscountSummary, ruleIsProvisionable } from "@/lib/sales/provision";
import { ownSummary } from "@/lib/sales/reporting";
import { holdDaysOf, loadSettings, rulesOf } from "@/lib/sales/settings";

/**
 * Everything the affiliate portal's home screen needs, in one request.
 *
 * One route rather than four because this is a phone on a patchy connection:
 * four round trips is four chances to show a half-drawn screen, and the whole
 * page is useless without all of it anyway.
 *
 * What it does **not** return matters as much. No password hash — `select:
 * false` on the schema and never asked for. No other rep's figures, no
 * company-wide totals, and no commission rates for rules this rep does not hold
 * a code under. A portal is not a smaller admin panel.
 */
export async function GET() {
  try {
    const auth = await apiPartner();
    if ("response" in auth) return auth.response;
    await connectDb();

    const { rep } = auth;
    const repId = String(rep._id);
    const status = repStatusOf(rep);
    const active = rep.active !== false;

    const [summary, settings] = await Promise.all([ownSummary(repId), loadSettings()]);

    const coupons = (rep.coupons ?? []).map(coupon => ({
      code: normaliseCode(coupon.code ?? ""),
      suffix: coupon.suffix ?? "",
      active: coupon.active !== false,
      setup: couponSetupOf(coupon),
      setupError: coupon.setupError,
      issuedBy: coupon.issuedBy ?? "Admin",
      issuedAt: coupon.issuedAt ? new Date(coupon.issuedAt).toISOString() : undefined
    }));

    const held = new Set(coupons.filter(coupon => coupon.active).map(coupon => coupon.suffix));

    /*
     * The rules they may still take a code under.
     *
     * `rate` is included because it is the rep's own commission and hiding it
     * would make the portal useless — but only for rules that are live, and only
     * ever alongside what the coupon gives the customer, so the two figures are
     * never confused with one another. They are routinely different and the
     * confusion is expensive.
     */
    const rules = rulesOf(settings).filter(rule => rule.active).map(rule => ({
      suffix: rule.suffix,
      label: rule.label,
      rate: rule.rate,
      customerDiscount: customerDiscountSummary(rule),
      /** Whether a code under it can be created in the shop straight away. */
      readyInShop: ruleIsProvisionable(rule),
      /** They already hold a live code under this rule. */
      held: held.has(rule.suffix)
    }));

    return ok({
      profile: {
        _id: repId,
        name: rep.name ?? "",
        code: rep.code ?? "",
        email: rep.email,
        phone: rep.phone,
        status,
        active,
        reviewNote: rep.reviewNote,
        coupons
      },
      /** Why they cannot act, when they cannot. Null is the ordinary case. */
      refusal: refusalFor(status, active),
      summary,
      rules,
      /** How long a delivered order is held before it can be paid — the most-asked question here. */
      holdDays: holdDaysOf(settings),
      maxCoupons: MAX_COUPONS_PER_REP
    });
  } catch (error) {
    return fail(error);
  }
}
