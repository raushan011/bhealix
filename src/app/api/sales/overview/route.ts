import { connectDb } from "@/lib/db/mongoose";
import { SalesPayout } from "@/models/Sales";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { fail, ok } from "@/lib/api";
import { todayIso } from "@/lib/time";
import { nextRunDate, proposePeriod } from "@/lib/sales/payouts";
import { salesOverview } from "@/lib/sales/reporting";
import { backfillDaysOf, loadSettings } from "@/lib/sales/settings";

/** The dashboard, over a window that defaults to the last thirty days. */
export async function GET(request: Request) {
  try {
    const auth = await apiSession(can.viewSales);
    if ("response" in auth) return auth.response;
    await connectDb();

    const params = new URL(request.url).searchParams;
    const from = params.get("from");
    const to = params.get("to");

    const window = {
      from: from ? new Date(`${from}T00:00:00`) : new Date(Date.now() - 30 * 86_400_000),
      to: to ? new Date(`${to}T23:59:59.999`) : undefined
    };

    const [overview, settings, last] = await Promise.all([
      salesOverview(window),
      loadSettings(),
      SalesPayout.findOne({}).sort({ to: -1 }).select("to payoutNo status").lean() as Promise<{ to?: string; payoutNo?: string; status?: string } | null>
    ]);

    const today = todayIso();
    return ok({
      ...overview,
      lastPayout: last,
      nextPayoutDate: nextRunDate(today, settings.payoutWeekday ?? 1),
      proposedPeriod: proposePeriod(last?.to, today, backfillDaysOf(settings)),
      holdDays: settings.holdDays ?? 7,
      connected: {
        shopify: Boolean(settings.shopifyDomain),
        shiprocket: Boolean(settings.shiprocketEmail),
        lastOrderSyncAt: settings.lastOrderSyncAt,
        lastShipmentSyncAt: settings.lastShipmentSyncAt,
        lastOrderSyncError: settings.lastOrderSyncError,
        lastShipmentSyncError: settings.lastShipmentSyncError
      }
    });
  } catch (error) {
    return fail(error);
  }
}
