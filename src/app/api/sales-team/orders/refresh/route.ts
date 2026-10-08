import { connectDb } from "@/lib/db/mongoose";
import { SalesTeamOrder } from "@/models/SalesTeam";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok } from "@/lib/api";
import { loadCredentials, shiprocketToken } from "@/lib/sales/settings";
import type { ShiprocketListedOrder } from "@/lib/sales/shiprocket";
import { orderScope } from "@/lib/sales-team/access";
import { listingSince, syncTeamOrder, UNBOOKED_LOOKBACK_DAYS } from "@/lib/sales-team/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Enough parcels to cover an executive's moving orders, few enough to finish inside a minute. */
const LIMIT = 40;
/** Orders not shipped yet, looked up by name — each can take a few calls, so fewer of them. */
const UNBOOKED_LIMIT = 15;
/** An automatic refresh leaves alone what was checked this recently. */
const FRESH_MS = 10 * 60_000;
/** Stop starting new lookups after this, so the answer always arrives inside `maxDuration`. */
const BUDGET_MS = 45_000;

/**
 * Brings the signed-in person's orders up to date with Shiprocket
 * (`syncTeamOrder`): every moving parcel by its courier scan — including the
 * expected delivery day the "delivering today / tomorrow" lists are built on —
 * and every order not shipped yet, found in Shiprocket under its own number or
 * as the copy the office re-made and shipped instead.
 *
 * The executive's screens call it on their own as they open (`?auto=1`, which
 * skips anything checked in the last ten minutes); the Refresh button forces it.
 */
export async function POST(request: Request) {
  try {
    const auth = await apiSession(can.placeSalesOrder);
    if ("response" in auth) return auth.response;
    await connectDb();

    const token = await shiprocketToken(await loadCredentials());
    if (!token) return badRequest("Shiprocket is not connected.", 502);

    const auto = new URL(request.url).searchParams.get("auto") === "1";
    const scope = { ...(orderScope(auth.session) ?? {}), cancelledAt: null };
    const stale = auto ? { $or: [{ "shipment.checkedAt": null }, { "shipment.checkedAt": { $lt: new Date(Date.now() - FRESH_MS) } }] } : {};
    const started = Date.now();

    const [unbooked, moving] = await Promise.all([
      SalesTeamOrder.find({
        ...scope, ...stale,
        "shipment.awb": { $in: [null, ""] }, placedAt: { $gte: new Date(Date.now() - UNBOOKED_LOOKBACK_DAYS * 86_400_000) }
      }).sort({ "shipment.checkedAt": 1, placedAt: -1 }).limit(UNBOOKED_LIMIT),
      SalesTeamOrder.find({
        ...scope, ...stale,
        "shipment.awb": { $nin: [null, ""] }, "delivery.state": { $in: ["Awaiting", "In transit", "Undelivered"] }
      }).sort({ "shipment.checkedAt": 1 }).limit(LIMIT)
    ]);

    // One read of Shiprocket's order list, shared by every order that needs it.
    const since = unbooked.reduce<Date | null>((min, order) => (!min || order.placedAt < min ? order.placedAt : min), null);
    let shared: Promise<ShiprocketListedOrder[]> | null = null;
    const listing = () => (shared ??= since ? listingSince(token, since) : Promise.resolve([]));

    let updated = 0;
    let failed = 0;
    let shipped = 0;
    for (const order of [...unbooked, ...moving]) {
      if (Date.now() - started > BUDGET_MS) break;
      try {
        const result = await syncTeamOrder(token, order, listing);
        await order.save();
        if (result.found) updated++;
        if (result.shipped) shipped++;
      } catch {
        failed++;
      }
    }
    return ok({ checked: unbooked.length + moving.length, updated, failed, shipped });
  } catch (error) {
    return fail(error);
  }
}
