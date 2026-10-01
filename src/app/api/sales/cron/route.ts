import { connectDb } from "@/lib/db/mongoose";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok } from "@/lib/api";
import { IntegrationError } from "@/lib/sales/http";
import { recalculateAll, recordedSync, syncAll } from "@/lib/sales/sync";
import { syncTeamShipments, syncTeamShopify } from "@/lib/sales-team/server";

/**
 * The nightly pass: pull what is new, then re-price everything not yet paid.
 *
 * The pull is what makes a delivery show up as money owed without anybody
 * pressing Sync — the courier reports overnight, and the partner sees "owed to
 * you" in the morning. The re-pricing behind it catches whatever the pull did
 * not touch: a rule edited during the day, an order the courier's feed missed.
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

    /*
     * The sales team's parcels go out through the same Shiprocket account, so
     * the same nightly pass reads their status back — which is what turns a
     * delivery into an incentive owed by morning. Run on its own and never
     * allowed to fail the affiliate pass: they are separate businesses.
     */
    const teamShop = await syncTeamShopify().catch(() => null);
    const team = { ...(await syncTeamShipments().catch(error => ({ error: error instanceof Error ? error.message : "Team sync failed" }))), shopify: teamShop };

    try {
      const report = await recordedSync(syncAll, { trigger: scheduled ? "Scheduled" : "Manual", target: "all" });
      const recalculated = await recalculateAll();
      return ok({ ...report, commissionsRecalculated: recalculated, scheduled, team });
    } catch (error) {
      // A failed pull must not stop the re-pricing: a rule changed yesterday
      // should reach every open order whether or not Shopify answered today.
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
