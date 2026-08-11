import { SalesOrder, SalesRep, SalesSettings, SalesSyncRun } from "@/models/Sales";
import { toDateInput, todayIso } from "@/lib/time";
import { recalculateCommission } from "./commission";
import { attributeOrder, normaliseCode, parseCoupon } from "./coupons";
import { deliveryStateFrom } from "./delivery";
import { IntegrationError } from "./http";
import { addIsoDays } from "./payouts";
import { backfillDaysOf, holdDaysOf, loadCredentials, rulesOf, shiprocketToken, shopifyConfig } from "./settings";
import { codesOn, fetchOrders, mapOrder, type ShopifyOrder } from "./shopify";
import type { CommissionRule } from "./commission";
import { fetchShipments, matchKey, matchKeysFor } from "./shiprocket";
import { emptyReport, type SyncReport } from "./types";

/**
 * Pulling the outside world in.
 *
 * Two passes, deliberately separate. Shopify says what was ordered and by whose
 * coupon; Shiprocket says whether it arrived. Either can be run alone — which
 * matters, because they fail independently and a Shiprocket outage must not
 * stop new orders being attributed.
 *
 * Both passes end at the same place: `recalculateCommission`, the only thing
 * that writes what anybody is owed.
 */

/**
 * Orders are pulled by `updated_at` with an hour's overlap on the last run.
 *
 * The overlap is not superstition. Shopify's `updated_at` is set when the write
 * lands, and an order can be indexed a moment after that — a window starting
 * exactly where the last one ended will eventually skip one, and a skipped order
 * is a rep not paid with nothing on any screen to say why. An hour of re-reading
 * costs nothing, because every write is an upsert.
 */
const OVERLAP_MS = 60 * 60 * 1000;

/** Every coupon code in the directory, pointing at the rep who holds it. */
export async function couponIndex(): Promise<Map<string, { repId: string; suffix: string }>> {
  const reps = await SalesRep.find({}).select("code coupons").lean() as
    { _id: unknown; coupons?: { code?: string; suffix?: string }[] }[];

  const index = new Map<string, { repId: string; suffix: string }>();
  for (const rep of reps) {
    for (const coupon of rep.coupons ?? []) {
      const code = normaliseCode(coupon.code ?? "");
      // A withdrawn coupon still attributes: the orders it already brought in
      // have to keep pointing at the person who earned them.
      if (code) index.set(code, { repId: String(rep._id), suffix: coupon.suffix ?? parseCoupon(code)?.suffix ?? "" });
    }
  }
  return index;
}

/**
 * Writes one Shopify order, whether it arrived by a scheduled pull or by a
 * webhook seconds after it was placed.
 *
 * **One code path on purpose.** Two places writing an order is two places for
 * the mapping to drift, and the drift would show up as a rep paid one figure by
 * the webhook and a different figure by the nightly sync — with no way to tell
 * which was right.
 */
export async function saveShopifyOrder(
  raw: ShopifyOrder,
  match: { code: string; repId: string },
  coupons: Map<string, { repId: string; suffix: string }>,
  rules: CommissionRule[],
  holdDays: number,
  known?: OrderDocument
): Promise<"created" | "updated"> {
  const mapped = mapOrder(raw, match.code);
  const suffix = coupons.get(match.code)?.suffix || parseCoupon(match.code)?.suffix || "";

  const existing = known ?? await SalesOrder.findOne({ shopifyOrderId: mapped.shopifyOrderId });
  const order: OrderDocument = existing ?? new SalesOrder({ source: "Shopify", shopifyOrderId: mapped.shopifyOrderId });

  Object.assign(order, {
    source: "Shopify",
    shopifyOrderId: mapped.shopifyOrderId,
    name: mapped.name, orderNumber: mapped.orderNumber, placedAt: mapped.placedAt, currency: mapped.currency,
    customer: mapped.customer, couponCode: match.code, rep: match.repId, ruleSuffix: suffix,
    discountCodes: mapped.discountCodes, items: mapped.items, totals: mapped.totals,
    financialStatus: mapped.financialStatus, paymentMethod: mapped.paymentMethod,
    // `null`, not `undefined`: assigning undefined leaves a stored value in
    // place, so an order that was cancelled and then reinstated in Shopify
    // would stay cancelled here and never pay.
    cancelledAt: mapped.cancelledAt ?? null,
    fullyRefunded: mapped.fullyRefunded,
    syncedAt: new Date()
  });

  recalculateCommission(order, rules, { holdDays });
  await order.save();
  return existing ? "updated" : "created";
}

/** The mongoose document, kept loose because the model itself is untyped. */
type OrderDocument = Parameters<typeof recalculateCommission>[0] & { save: () => Promise<unknown> };

// ---------------------------------------------------------------- orders pass

export async function syncOrders(options: { since?: Date } = {}): Promise<SyncReport> {
  const report = emptyReport();
  const settings = await loadCredentials();
  const config = shopifyConfig(settings);

  if (!config) {
    throw new IntegrationError("Shopify", "Shopify is not connected. Add the shop address and Admin API access token under Sales settings.");
  }

  const since = options.since
    ?? (settings.lastOrderSyncAt
      ? new Date(new Date(settings.lastOrderSyncAt).getTime() - OVERLAP_MS)
      : new Date(Date.now() - backfillDaysOf(settings) * 86_400_000));

  // Reported, because "0 orders read" and "0 orders read since four minutes
  // ago" are different facts and only one of them is a problem. An incremental
  // sync run twice in a minute is *supposed* to find nothing.
  report.ordersSince = since.toISOString();

  let orders;
  try {
    orders = await fetchOrders(config, since);
  } catch (error) {
    await SalesSettings.updateOne({ key: "sales" }, { $set: { lastOrderSyncError: messageOf(error) } });
    throw error;
  }

  report.ordersSeen = orders.length;
  const coupons = await couponIndex();
  // Built once, not per order: attribution is the inner loop of the whole sync.
  const byCode = new Map([...coupons].map(([code, value]) => [code, value.repId]));
  const rules = rulesOf(settings);
  const holdDays = holdDaysOf(settings);
  const unknown = new Set<string>();

  const ids = orders.map(order => String(order.id));
  const existing = new Map((await SalesOrder.find({ shopifyOrderId: { $in: ids } })).map(doc => [doc.shopifyOrderId, doc]));

  for (const raw of orders) {
    const codes = codesOn(raw);
    const match = attributeOrder(codes, byCode);

    if (!match) {
      report.ordersSkipped++;
      // A code shaped like a rep's — NAME then digits — that belongs to nobody
      // is nearly always a coupon created in Shopify and never added here. Worth
      // naming, because the money is already out of the door.
      for (const code of codes) if (parseCoupon(code)) unknown.add(code);
      continue;
    }

    report.ordersAttributed++;
    const outcome = await saveShopifyOrder(raw, match, coupons, rules, holdDays, existing.get(String(raw.id)));
    if (outcome === "created") report.ordersCreated++; else report.ordersUpdated++;
    report.commissionsRecalculated++;
  }

  report.unknownCoupons = [...unknown];
  if (unknown.size) {
    report.warnings.push(`${unknown.size} coupon code${unknown.size === 1 ? "" : "s"} on recent orders belong to no rep here: ${[...unknown].join(", ")}. Add the rep, or the orders will never be attributed.`);
  }

  await SalesSettings.updateOne({ key: "sales" }, { $set: { lastOrderSyncAt: new Date() }, $unset: { lastOrderSyncError: "" } });
  return report;
}

// -------------------------------------------------------------- shipment pass

export async function syncShipments(options: { from?: string; to?: string } = {}): Promise<SyncReport> {
  const report = emptyReport();
  const settings = await loadCredentials();
  const token = await shiprocketToken(settings);

  if (!token) {
    throw new IntegrationError("Shiprocket", "Shiprocket is not connected. Add the API user's email and password under Sales settings.");
  }

  const today = todayIso();
  // Reach back far enough to cover anything still moving. A parcel placed five
  // weeks ago and delivered this morning is precisely the case that pays
  // somebody, so the window is driven by the oldest unsettled order rather than
  // by a fixed fortnight.
  const oldest = await SalesOrder.findOne({ "delivery.state": { $in: ["Awaiting", "In transit", "Undelivered"] } })
    .sort({ placedAt: 1 }).select("placedAt").lean() as { placedAt?: Date } | null;

  // The earlier of the two, so both the recent window and a stubborn old parcel
  // are covered — clamped at two years, because an order unsettled for longer
  // than that is a data problem, not a delivery.
  const floor = addIsoDays(today, -backfillDaysOf(settings));
  const oldestIso = oldest?.placedAt ? isoOf(oldest.placedAt) : floor;
  const from = options.from ?? maxIso(addIsoDays(today, -730), minIso(floor, oldestIso));
  const to = options.to ?? today;
  report.from = from;
  report.to = to;

  let updates;
  try {
    updates = await fetchShipments(token, from, to);
  } catch (error) {
    await SalesSettings.updateOne({ key: "sales" }, { $set: { lastShipmentSyncError: messageOf(error) } });
    throw error;
  }

  const byKey = new Map(updates.map(update => [matchKey(update.channelOrderId), update]));
  const rules = rulesOf(settings);
  const holdDays = holdDaysOf(settings);

  // Only our own orders are walked, and only the ones that could still change.
  // Most of what Shiprocket returns belongs to orders no affiliate brought in.
  const orders = await SalesOrder.find({
    placedAt: { $gte: new Date(`${from}T00:00:00`) },
    $or: [{ "delivery.state": { $in: ["Awaiting", "In transit", "Undelivered"] } }, { "commission.status": { $in: ["Pending", "Maturing"] } }]
  });

  for (const order of orders) {
    const update = matchKeysFor(order).map(key => byKey.get(key)).find(Boolean);
    if (!update) {
      report.shipmentsUnmatched++;
      continue;
    }

    report.shipmentsMatched++;
    const reported = deliveryStateFrom(update.status, update.statusCode);
    const changed = order.delivery.reported !== reported;

    order.shipment = {
      shiprocketOrderId: update.shiprocketOrderId,
      shipmentId: update.shipmentId,
      awb: update.awb,
      courier: update.courier,
      status: update.status,
      statusCode: update.statusCode,
      // Once a delivery date is known it is never unlearned — a later status
      // that omits it must not restart the seven-day clock.
      deliveredAt: update.deliveredAt ?? order.shipment?.deliveredAt,
      checkedAt: new Date()
    };
    order.delivery.reported = reported;
    if (changed) order.delivery.at = new Date();

    recalculateCommission(order, rules, { holdDays });
    await order.save();
    report.commissionsRecalculated++;
  }

  await SalesSettings.updateOne({ key: "sales" }, { $set: { lastShipmentSyncAt: new Date() }, $unset: { lastShipmentSyncError: "" } });
  return report;
}

// ------------------------------------------------------------------- the rest

/**
 * Re-prices every order no payout run has claimed.
 *
 * Run after a rate or a hold period changes, and on a schedule — a commission
 * whose window elapses overnight has to become payable without anybody touching
 * it, and nothing else in the system would notice the day turning.
 */
export async function recalculateAll(): Promise<number> {
  const settings = await loadCredentials();
  const rules = rulesOf(settings);
  const holdDays = holdDaysOf(settings);

  const orders = await SalesOrder.find({ "commission.status": { $nin: ["In payout", "Paid"] } });
  for (const order of orders) {
    recalculateCommission(order, rules, { holdDays });
    await order.save();
  }
  return orders.length;
}

/** Both passes, orders first — a shipment for an order we have not pulled yet is no use. */
export async function syncAll(): Promise<SyncReport> {
  const orders = await syncOrders();
  let shipments: SyncReport | null = null;
  try {
    shipments = await syncShipments();
  } catch (error) {
    // Shopify succeeded; saying so and naming the Shiprocket failure is more
    // useful than losing both halves to one thrown error.
    orders.warnings.push(messageOf(error));
  }

  return {
    ...orders,
    shipmentsMatched: shipments?.shipmentsMatched ?? 0,
    shipmentsUnmatched: shipments?.shipmentsUnmatched ?? 0,
    commissionsRecalculated: orders.commissionsRecalculated + (shipments?.commissionsRecalculated ?? 0),
    warnings: [...orders.warnings, ...(shipments?.warnings ?? [])],
    from: shipments?.from,
    to: shipments?.to
  };
}

/** 90 days of history is enough to see a pattern and not enough to grow into a problem. */
const HISTORY_DAYS = 90;

/**
 * Runs a pass and writes down what it did — including, especially, that it
 * failed. A run that is only recorded when it succeeds turns a broken schedule
 * into silence.
 */
export async function recordedSync(
  run: () => Promise<SyncReport>,
  context: { trigger: "Manual" | "Scheduled" | "Webhook"; target: string; actor?: string }
): Promise<SyncReport> {
  const startedAt = Date.now();

  const write = async (report: Partial<SyncReport>, error?: string) => {
    try {
      await SalesSyncRun.create({
        ...context,
        ...report,
        durationMs: Date.now() - startedAt,
        finishedAt: new Date(),
        error,
        expiresAt: new Date(Date.now() + HISTORY_DAYS * 86_400_000)
      });
    } catch (problem) {
      // The history is a convenience; losing a row must never lose the sync.
      console.error("Could not record a sync run", problem);
    }
  };

  try {
    const report = await run();
    await write(report);
    return report;
  } catch (error) {
    await write({}, messageOf(error));
    throw error;
  }
}

const messageOf = (error: unknown) => error instanceof Error ? error.message : "Something went wrong.";
const isoOf = (date: Date) => toDateInput(new Date(date));
const maxIso = (a: string, b: string) => (a > b ? a : b);
const minIso = (a: string, b: string) => (a < b ? a : b);
