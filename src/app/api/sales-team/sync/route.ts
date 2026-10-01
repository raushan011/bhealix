import { connectDb } from "@/lib/db/mongoose";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok } from "@/lib/api";
import { IntegrationError } from "@/lib/sales/http";
import { syncTeamShipments, syncTeamShopify } from "@/lib/sales-team/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Reads every open team parcel's status back from Shiprocket, now rather than
 * tonight. Reading a status decides no money by itself — the incentive follows
 * whatever the courier reports — so the desk that reads the Sales CRM may press
 * it. An integration failure is a 502 carrying Shiprocket's own words.
 */
export async function POST() {
  try {
    const auth = await apiSession(can.viewSalesTeam);
    if ("response" in auth) return auth.response;
    await connectDb();
    try {
      // The shop first, for cancellations only it knows about; then the courier.
      const shopify = await syncTeamShopify().catch(() => ({ checked: 0, cancelled: 0 }));
      return ok({ ...(await syncTeamShipments()), shopify });
    } catch (error) {
      if (error instanceof IntegrationError) return badRequest(error.message, 502);
      throw error;
    }
  } catch (error) {
    return fail(error);
  }
}
