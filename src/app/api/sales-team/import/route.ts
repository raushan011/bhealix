import { connectDb } from "@/lib/db/mongoose";
import { SalesTeamSettings } from "@/models/SalesTeam";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { fail, ok } from "@/lib/api";
import { importShopOrders } from "@/lib/sales-team/shop-import-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** The first pass reads every shop and courier order since 1 September; later ones only what is new. */
export const maxDuration = 60;

/** An automatic pass leaves alone an import this recent. */
const FRESH_MS = 10 * 60_000;

/**
 * Brings every shop order (Shopify) and courier-only order (Shiprocket) since
 * 1 September 2026 into the Sales CRM, then whatever is new — see
 * `lib/sales-team/shop-import.ts` for the rules. The desk's orders screen calls
 * it as it opens (`?auto=1`, skipped when the last pass was under ten minutes
 * ago); the nightly pass and Shopify's order webhook keep it going between.
 * `?full=1` (an administrator) reaches back to 1 September again.
 */
export async function POST(request: Request) {
  try {
    const auth = await apiSession(can.viewSalesTeam);
    if ("response" in auth) return auth.response;
    await connectDb();

    const params = new URL(request.url).searchParams;
    if (params.get("auto") === "1") {
      const settings = await SalesTeamSettings.findOne({ key: "sales-team" }).select("lastShopImportAt").lean() as { lastShopImportAt?: Date } | null;
      if (settings?.lastShopImportAt && Date.now() - new Date(settings.lastShopImportAt).getTime() < FRESH_MS) return ok({ skipped: true, added: 0 });
    }

    const report = await importShopOrders({ full: params.get("full") === "1" && can.manageSalesTeam(auth.session.role) });
    return ok({ ...report, added: (report.shopify?.added ?? 0) + (report.shiprocket?.added ?? 0) });
  } catch (error) {
    return fail(error);
  }
}
