import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok } from "@/lib/api";
import { record } from "@/lib/audit";
import { IntegrationError } from "@/lib/sales/http";
import { recalculateAll, recordedSync, syncAll, syncOrders, syncShipments } from "@/lib/sales/sync";
import { SalesSyncRun } from "@/models/Sales";

const schema = z.object({
  target: z.enum(["all", "orders", "shipments", "recalculate"]).default("all"),
  /** Reaches further back than the last sync did — for a first pull or a repair. */
  sinceDays: z.number().int().min(1).max(730).optional()
});

/**
 * Pulls from Shopify and Shiprocket on demand.
 *
 * Runs inline rather than on a queue: this is a few hundred orders on a small
 * operation, and an operator who presses Sync wants to be told what happened,
 * not that a job has been enqueued somewhere they cannot see.
 *
 * An integration failure comes back as a 502 with the other side's own words on
 * it, because "Shopify refused the token (401)" tells somebody which field to
 * fix and "something went wrong" does not.
 */
/** The last twenty passes, so the automation can be seen working rather than believed in. */
export async function GET() {
  try {
    const auth = await apiSession(can.viewSales);
    if ("response" in auth) return auth.response;
    await connectDb();

    const runs = await SalesSyncRun.find({}).sort({ finishedAt: -1 }).limit(20)
      .populate("actor", "name").lean();
    return ok({ runs, scheduled: Boolean(process.env.CRON_SECRET) });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await apiSession(can.manageSales);
    if ("response" in auth) return auth.response;
    await connectDb();

    const body = await request.json().catch(() => ({}));
    const { target, sinceDays } = schema.parse(body);
    const since = sinceDays ? new Date(Date.now() - sinceDays * 86_400_000) : undefined;

    try {
      if (target === "recalculate") {
        const count = await recalculateAll();
        return ok({ target, commissionsRecalculated: count });
      }

      const report = await recordedSync(
        () => target === "orders" ? syncOrders({ since }) : target === "shipments" ? syncShipments() : syncAll(),
        { trigger: "Manual", target, actor: auth.session.userId }
      );

      await record({
        actor: auth.session.userId,
        action: "sales.synced",
        entityType: "SalesSettings",
        entityId: target,
        metadata: { target, created: report.ordersCreated, updated: report.ordersUpdated, matched: report.shipmentsMatched }
      });

      return ok({ target, ...report });
    } catch (error) {
      if (error instanceof IntegrationError) return badRequest(error.message, 502);
      throw error;
    }
  } catch (error) {
    return fail(error);
  }
}
