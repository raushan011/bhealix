import { connectDb } from "@/lib/db/mongoose";
import { SalesOrder } from "@/models/Sales";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { fail, ok } from "@/lib/api";
import { salesOverview } from "@/lib/sales/reporting";
import { loadSettings } from "@/lib/sales/settings";

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

    const [overview, settings, owed] = await Promise.all([
      salesOverview(window),
      loadSettings(),
      // What is owed right now, over the whole history rather than the window:
      // a delivery from six weeks ago that was never paid is still owed, and
      // the card that says "3 orders to pay" must not lose it because the
      // dashboard defaults to a month.
      SalesOrder.aggregate<{ count: number; amount: number }>([
        { $match: { "commission.status": "Payable", rep: { $ne: null } } },
        { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: "$commission.amount" } } }
      ])
    ]);

    return ok({
      ...overview,
      owed: { count: owed[0]?.count ?? 0, amount: Math.round(owed[0]?.amount ?? 0) },
      mayPay: can.paySalesCommission(auth.session.role),
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
