import { connectDb } from "@/lib/db/mongoose";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok } from "@/lib/api";
import { IntegrationError } from "@/lib/sales/http";
import { recalculateAll, recordedSync, syncAll } from "@/lib/sales/sync";

/**
 * The nightly pass: pull what is new, then re-price everything still open.
 *
 * The re-pricing is the part that cannot be left to a person. A commission
 * becomes payable because a week went by — nothing happens to the order, the
 * seventh day simply arrives — so without something running on a clock, the
 * dashboard would keep reporting yesterday's answer until somebody pressed Sync.
 *
 * (The payout run itself does not depend on this. It matches on the maturity
 * date rather than the stored status, so a week that matured overnight is swept
 * in whether or not this ever ran. This keeps the *screens* honest; the run is
 * correct regardless.)
 *
 * Two ways in, because there are two callers. A scheduler presents
 * `CRON_SECRET` as a bearer token — the shape Vercel Cron sends — and an
 * administrator can call it from a signed-in session to force a pass by hand.
 * With no secret configured, only the session route works: an unauthenticated
 * endpoint that reaches out to Shopify on request is not something to leave open
 * by default.
 */
export async function GET(request: Request) {
  try {
    const secret = process.env.CRON_SECRET;
    const presented = request.headers.get("authorization");
    const scheduled = Boolean(secret) && presented === `Bearer ${secret}`;

    if (!scheduled) {
      const auth = await apiSession(can.manageSales);
      if ("response" in auth) return auth.response;
    }

    await connectDb();

    try {
      const report = await recordedSync(syncAll, { trigger: scheduled ? "Scheduled" : "Manual", target: "all" });
      const recalculated = await recalculateAll();
      return ok({ ...report, commissionsRecalculated: recalculated, scheduled });
    } catch (error) {
      // A failed pull must not stop maturity: a rep whose parcel was delivered
      // last week is owed their money whether or not Shopify answered today.
      const recalculated = await recalculateAll();
      if (error instanceof IntegrationError) {
        return badRequest(`${error.message} Commissions were still re-priced (${recalculated}).`, 502);
      }
      throw error;
    }
  } catch (error) {
    return fail(error);
  }
}
