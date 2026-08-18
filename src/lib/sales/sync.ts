import { SalesCoupon, SalesOrder, SalesRep, SalesSettings, SalesSyncRun } from "@/models/Sales";
import { noteCodesSeen, refreshFromShopify } from "./catalogue";
import { shiftDay, toDateInput, todayIso } from "@/lib/time";
import { recalculateCommission } from "./commission";
import { attributeOrder, normaliseCode, parseCoupon } from "./coupons";
import { deliveryStateFrom } from "./delivery";
import { IntegrationError } from "./http";
import { backfillDaysOf, loadCredentials, rulesOf, shiprocketToken, shopifyConfig } from "./settings";
import { codesOn, fetchOrders, mapOrder, mergeCustomer, type MappedOrder, type ShopifyOrder } from "./shopify";
import type { CommissionRule } from "./commission";
import { fetchShipments, matchKey, matchKeysFor } from "./shiprocket";
import { applyShipmentsToShopOrders, recordShopOrders } from "./shop-orders";
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

/**
 * How far back an order pull reaches.
 *
 * Three cases, and the first one is the whole point of pulling this out where a
 * test can reach it: an explicit `since` **always wins**. That is what "Full
 * resync" sends, and a version of this that quietly preferred the last run's
 * timestamp turned the repair button into an ordinary incremental sync — which
 * then reported "0 orders read" and looked exactly like a broken integration.
 */
export function windowStart(explicit: Date | undefined, lastSyncAt: Date | undefined, backfillDays: number, now = Date.now()): Date {
  if (explicit) return explicit;
  if (lastSyncAt) return new Date(new Date(lastSyncAt).getTime() - OVERLAP_MS);
  return new Date(now - backfillDays * 86_400_000);
}

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
    // Merged rather than replaced, so an address typed in to get the parcel
    // booked survives the next pass — see `mergeCustomer`.
    customer: mergeCustomer(existing?.customer, mapped.customer),
    couponCode: match.code, rep: match.repId, ruleSuffix: suffix,
    discountCodes: mapped.discountCodes, items: mapped.items, totals: mapped.totals,
    financialStatus: mapped.financialStatus, paymentMethod: mapped.paymentMethod,
    // `null`, not `undefined`: assigning undefined leaves a stored value in
    // place, so an order that was cancelled and then reinstated in Shopify
    // would stay cancelled here and never pay.
    cancelledAt: mapped.cancelledAt ?? null,
    fullyRefunded: mapped.fullyRefunded,
    syncedAt: new Date()
  });

  recalculateCommission(order, rules);
  await order.save();
  return existing ? "updated" : "created";
}

/** The mongoose document, kept loose because the model itself is untyped. */
type OrderDocument = Parameters<typeof recalculateCommission>[0] & {
  /** Read back on a re-sync so a typed-in address is not overwritten with nothing. */
  customer?: MappedOrder["customer"];
  save: () => Promise<unknown>;
};

// ---------------------------------------------------------------- orders pass

export async function syncOrders(options: { since?: Date } = {}): Promise<SyncReport> {
  const report = emptyReport();
  const settings = await loadCredentials();
  const config = shopifyConfig(settings);

  if (!config) {
    throw new IntegrationError("Shopify", "Shopify is not connected. Add the shop address and Admin API access token under Sales settings.");
  }

  const since = windowStart(options.since, settings.lastOrderSyncAt, backfillDaysOf(settings));

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
  const unknown = new Set<string>();

  /*
   * Codes already marked as belonging to nobody — a launch promo, a campaign.
   *
   * Read from the catalogue rather than a list typed into settings, so that
   * marking a code on the Coupons screen is what silences it. A code Shopify
   * has since deactivated is silenced too: it cannot bring in another order, so
   * naming it every pass is noise about something nobody can act on.
   */
  const ignored = new Set((await SalesCoupon.find({ $or: [{ ignored: true }, { status: { $in: ["EXPIRED", "SCHEDULED"] } }] })
    .select("code").lean() as { code?: string }[])
    .map(entry => normaliseCode(entry.code ?? "")));

  const ids = orders.map(order => String(order.id));
  const existing = new Map((await SalesOrder.find({ shopifyOrderId: { $in: ids } })).map(doc => [doc.shopifyOrderId, doc]));

  // Every code on every order goes into the catalogue, attributed or not — an
  // unattributed one is exactly the code nobody has claimed yet, which is the
  // whole reason the Coupons screen exists.
  await noteCodesSeen(orders.flatMap(codesOn));

  for (const raw of orders) {
    const codes = codesOn(raw);
    const match = attributeOrder(codes, byCode);

    if (!match) {
      report.ordersSkipped++;
      // A code shaped like a rep's — NAME then digits — that belongs to nobody
      // is nearly always a coupon created in Shopify and never added here. Worth
      // naming, because the money is already out of the door.
      for (const code of codes) if (parseCoupon(code) && !ignored.has(code)) unknown.add(code);
      continue;
    }

    report.ordersAttributed++;
    const outcome = await saveShopifyOrder(raw, match, coupons, rules, existing.get(String(raw.id)));
    if (outcome === "created") report.ordersCreated++; else report.ordersUpdated++;
    report.commissionsRecalculated++;
  }

  /*
   * Every order in the pull, attributed or not, into the retargeting list. After
   * the attributed writes above, so a row can point at the fuller record the
   * moment it exists. A failure here must not undo the commissions already
   * written — it is a warning, and the next pass re-reads the same orders.
   */
  try {
    await recordShopOrders(orders, byCode);
  } catch (error) {
    report.warnings.push(`Orders were attributed but the retargeting list could not be updated (${messageOf(error)}). It catches up on the next sync.`);
  }

  /*
   * The shop's own discount list, so a coupon created this morning appears on
   * the Coupons screen before anybody has used it.
   *
   * Needs `read_discounts`, which an older connection will not have — so a
   * failure is a note, not an error. Everything above it has already been
   * written and is not lost because the catalogue could not be refreshed.
   */
  try {
    await refreshFromShopify();
  } catch (error) {
    report.warnings.push(`Could not read the shop's discount list (${messageOf(error)}). Codes still appear once an order uses one; add the read_discounts scope to see them sooner.`);
  }

  report.unknownCoupons = [...unknown];
  if (unknown.size) {
    report.warnings.push(`${unknown.size} coupon code${unknown.size === 1 ? "" : "s"} on recent orders belong to no rep here: ${[...unknown].join(", ")}. Assign ${unknown.size === 1 ? "it" : "them"} under Coupons, or the orders will never be attributed.`);
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
  const floor = shiftDay(today, -backfillDaysOf(settings));
  const oldestIso = oldest?.placedAt ? isoOf(oldest.placedAt) : floor;
  const from = options.from ?? maxIso(shiftDay(today, -730), minIso(floor, oldestIso));
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

  // Only our own orders are walked, and only the ones that could still change.
  // Most of what Shiprocket returns belongs to orders no affiliate brought in.
  const orders = await SalesOrder.find({
    placedAt: { $gte: new Date(`${from}T00:00:00`) },
    $or: [{ "delivery.state": { $in: ["Awaiting", "In transit", "Undelivered"] } }, { "commission.status": "Pending" }]
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

    /*
     * Only the half of `shipment` this pass is the authority on.
     *
     * It used to assign the whole object, which was harmless while the courier's
     * feed was the only thing that ever wrote there. Orders are now booked from
     * the CRM (§ fulfilment), and that writes the other half — which warehouse,
     * which courier was chosen, the carton, who pressed the button. Replacing
     * the object wholesale would erase all of it on the next pass.
     *
     * Worse, `update.awb` is absent for an order Shiprocket has accepted but not
     * yet acknowledged an airway bill for, so a blind overwrite could blank an
     * AWB this system had just assigned — the order would read as unprocessed,
     * somebody would book it again, and one customer would get two parcels. Each
     * field is therefore only written when the courier actually said something.
     */
    order.set("shipment.shiprocketOrderId", update.shiprocketOrderId || order.shipment?.shiprocketOrderId);
    order.set("shipment.shipmentId", update.shipmentId || order.shipment?.shipmentId);
    order.set("shipment.awb", update.awb || order.shipment?.awb);
    order.set("shipment.courier", update.courier || order.shipment?.courier);
    order.set("shipment.status", update.status);
    order.set("shipment.statusCode", update.statusCode);
    // Once a delivery date is known it is never unlearned — a later status
    // that omits it must not blank the day the partner was told it arrived.
    order.set("shipment.deliveredAt", update.deliveredAt ?? order.shipment?.deliveredAt);
    order.set("shipment.checkedAt", new Date());
    order.delivery.reported = reported;
    if (changed) order.delivery.at = new Date();

    recalculateCommission(order, rules);
    await order.save();
    report.commissionsRecalculated++;
  }

  // The same feed, handed to the orders nobody's coupon brought in, so the
  // retargeting list can say "Delivered" about them too.
  try {
    await applyShipmentsToShopOrders(updates, from);
  } catch (error) {
    report.warnings.push(`Delivery status could not be copied to the retargeting list (${messageOf(error)}).`);
  }

  await SalesSettings.updateOne({ key: "sales" }, { $set: { lastShipmentSyncAt: new Date() }, $unset: { lastShipmentSyncError: "" } });
  return report;
}

// ------------------------------------------------------------------- the rest

/**
 * Re-prices every order that has not been paid.
 *
 * Run after a rate changes, and on a schedule, so a rule edited on Tuesday is
 * reflected on every open order by Wednesday morning whether or not anybody
 * pressed Sync. It matches on "not paid" rather than on a list of open
 * statuses, so an order left under a status this code no longer produces is
 * swept back into one it does.
 */
export async function recalculateAll(): Promise<number> {
  const settings = await loadCredentials();
  const rules = rulesOf(settings);

  const orders = await SalesOrder.find({ "commission.status": { $ne: "Paid" } });
  for (const order of orders) {
    recalculateCommission(order, rules);
    await order.save();
  }
  return orders.length;
}

/** Both passes, orders first — a shipment for an order we have not pulled yet is no use. */
export async function syncAll(options: { since?: Date } = {}): Promise<SyncReport> {
  // `options` is passed through, not ignored. Dropping it here is what made
  // "Full resync" quietly do an incremental one: the route parsed `sinceDays`,
  // turned it into a date, and handed it to a function that took no arguments.
  const orders = await syncOrders(options);
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
