import { connectDb } from "@/lib/db/mongoose";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok } from "@/lib/api";
import { loadTeamSettings } from "@/lib/sales-team/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What the sales team sells, at what price, and the rules that price it — the
 * Sales Team Handbook, as kept under Sales CRM → Settings.
 *
 * Not the shop's product list. The handbook is the price list executives quote
 * from: a fixed MRP per product, a Kit at its offer price, the Testing Kit flat,
 * and discounts that follow rules rather than whatever a Shopify variant happens
 * to be priced at. The order form prices with these, and the server prices the
 * order again with the same before saving it.
 */
export async function GET() {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    if (!can.placeSalesOrder(auth.session.role) && !can.viewSalesTeam(auth.session.role)) {
      return badRequest("You do not have access to this action", 403);
    }
    await connectDb();
    const settings = await loadTeamSettings();
    return ok({ catalogue: settings.catalogue.filter(item => item.active), pricing: settings.pricing });
  } catch (error) {
    return fail(error);
  }
}
