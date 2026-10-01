import { Types } from "mongoose";
import { Counter } from "@/models/Settings";
import { SalesTeamOrder, SalesTeamSettings } from "@/models/SalesTeam";
import { User } from "@/models/User";
import { deliveryStateFrom } from "@/lib/sales/delivery";
import type { DeliveryState } from "@/lib/sales/constants";
import { loadCredentials, shiprocketToken, shopifyConfig } from "@/lib/sales/settings";
import { fetchShipments, matchKey, matchKeysFor } from "@/lib/sales/shiprocket";
import { IntegrationError } from "@/lib/sales/http";
import { shiftDay, todayIso } from "@/lib/time";
import { priceIncentive, rulesTable, teamOrderNo, type IncentiveRule, type TeamOrderChannel } from "./orders";
import { canWriteOrders } from "./shopify-order";
import { fetchOrder, grantedScopes, type ShopifyConfig } from "@/lib/sales/shopify";
import { SalesSettings } from "@/models/Sales";

/**
 * The database half of the sales team: numbering, settings, keeping each
 * order's incentive in step with its delivery, and the per-executive totals the
 * Sales CRM and the executive's own panel both read.
 */

// ------------------------------------------------------------------ settings

export type TeamSettings = {
  orderChannel: TeamOrderChannel;
  incentiveRules: IncentiveRule[];
  fulfilment?: {
    pickupLocation?: string; weight?: number; length?: number; breadth?: number; height?: number;
    courierRule?: string; courierId?: number; courierName?: string;
  };
  lastShipmentSyncAt?: Date;
  lastShipmentSyncError?: string;
};

/** The singleton, created on first read so no screen handles an empty state (§4.11). */
export async function loadTeamSettings(): Promise<TeamSettings> {
  const doc = await SalesTeamSettings.findOneAndUpdate(
    { key: "sales-team" },
    { $setOnInsert: { key: "sales-team" } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean() as TeamSettings | null;
  return { ...(doc ?? {}), orderChannel: doc?.orderChannel ?? "Shopify", incentiveRules: rulesTable(doc?.incentiveRules) } as TeamSettings;
}

/**
 * The next order number, claimed by the database rather than counted — the same
 * atomic `$inc` invoices use, so two executives saving at the same moment get
 * two numbers.
 */
export async function nextTeamOrderNo(): Promise<string> {
  const counter = await Counter.findOneAndUpdate(
    { key: "sales-team-order" },
    { $inc: { value: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean() as unknown as { value: number };
  return teamOrderNo(counter.value);
}

// --------------------------------------------------------------- incentives

type IncentiveDoc = {
  totals?: { paid?: number };
  cancelledAt?: Date | null;
  delivery?: { reported?: string; override?: string | null; state?: string; at?: Date };
  incentive?: {
    enabled?: boolean; type?: string; value?: number; base?: number; amount?: number;
    status?: string; reason?: string; needsReversal?: boolean; computedAt?: Date;
  };
  set: (path: string, value: unknown) => void;
};

/**
 * Brings one order's delivery state and incentive up to date. The only thing
 * that writes `incentive.status` and `incentive.amount` (§4.4) — anything that
 * changes a delivery, a cancellation or a rule calls this and saves.
 */
export function recalculateIncentive(order: IncentiveDoc) {
  const state = (order.delivery?.override || order.delivery?.reported || "Awaiting") as DeliveryState;
  order.set("delivery.state", state);

  const base = Number(order.totals?.paid ?? 0);
  const result = priceIncentive({
    rule: {
      enabled: order.incentive?.enabled !== false,
      type: (order.incentive?.type === "Flat" ? "Flat" : "Percentage"),
      value: Number(order.incentive?.value ?? 0)
    },
    base,
    delivery: state,
    cancelled: Boolean(order.cancelledAt),
    paid: order.incentive?.status === "Paid"
  });

  order.set("incentive.base", base);
  // A paid incentive keeps the figure it was paid at, whatever the order says now.
  if (result.status !== "Paid") order.set("incentive.amount", result.amount);
  order.set("incentive.status", result.status);
  order.set("incentive.reason", result.reason);
  order.set("incentive.needsReversal", result.needsReversal);
  order.set("incentive.computedAt", new Date());
}

/** Freezes the rule for a payment mode onto an order, at the moment it is placed or re-priced. */
export function applyRule(order: IncentiveDoc, rule: IncentiveRule) {
  order.set("incentive.enabled", rule.enabled);
  order.set("incentive.type", rule.type);
  order.set("incentive.value", rule.value);
}

// ------------------------------------------------------------ delivery sync

export type TeamSyncReport = { matched: number; unmatched: number; updated: number; from: string; to: string };

const OPEN_STATES = ["Awaiting", "In transit", "Undelivered"];
const isoOf = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Reads every open team order's status back from Shiprocket.
 *
 * The affiliate sync's shipment pass (§8.8), applied to this collection: one
 * bulk read of the account's orders for a window reaching back to the oldest
 * parcel still moving, joined on the name the order was booked under. Only the
 * read-back half of `shipment` is written, field by field, for the reason given
 * there — replacing it wholesale would erase what the booking recorded.
 */
export async function syncTeamShipments(): Promise<TeamSyncReport> {
  const settings = await loadCredentials();
  const token = await shiprocketToken(settings);
  if (!token) {
    throw new IntegrationError("Shiprocket", "Shiprocket is not connected. Add the API user's email and password under Affiliate CRM → Settings.");
  }

  const today = todayIso();
  const oldest = await SalesTeamOrder.findOne({ "delivery.state": { $in: OPEN_STATES }, cancelledAt: null, "shipment.shiprocketOrderId": { $exists: true } })
    .sort({ placedAt: 1 }).select("placedAt").lean() as { placedAt?: Date } | null;
  const from = oldest?.placedAt ? isoOf(oldest.placedAt) : shiftDay(today, -30);
  const report: TeamSyncReport = { matched: 0, unmatched: 0, updated: 0, from: from < shiftDay(today, -365) ? shiftDay(today, -365) : from, to: today };

  const orders = await SalesTeamOrder.find({
    "shipment.shiprocketOrderId": { $exists: true },
    $or: [{ "delivery.state": { $in: OPEN_STATES } }, { "incentive.status": "Pending" }]
  });
  if (!orders.length) {
    await SalesTeamSettings.updateOne({ key: "sales-team" }, { $set: { lastShipmentSyncAt: new Date() }, $unset: { lastShipmentSyncError: "" } });
    return report;
  }

  let updates;
  try {
    updates = await fetchShipments(token, report.from, report.to);
  } catch (error) {
    await SalesTeamSettings.updateOne({ key: "sales-team" }, { $set: { lastShipmentSyncError: error instanceof Error ? error.message : "Shiprocket did not answer" } });
    throw error;
  }
  const byKey = new Map(updates.map(update => [matchKey(update.channelOrderId), update]));

  for (const order of orders) {
    const update = matchKeysFor(order).map(key => byKey.get(key)).find(Boolean);
    if (!update) { report.unmatched++; continue; }
    report.matched++;
    if (applyShipmentUpdate(order, update)) report.updated++;
    recalculateIncentive(order);
    await order.save();
  }

  await SalesTeamSettings.updateOne({ key: "sales-team" }, { $set: { lastShipmentSyncAt: new Date() }, $unset: { lastShipmentSyncError: "" } });
  return report;
}

type ShipmentFields = {
  shiprocketOrderId?: string; shipmentId?: string; awb?: string; courier?: string;
  status?: string; statusCode?: number; deliveredAt?: Date;
};

/**
 * Writes what the courier said onto an order, one field at a time, and reports
 * whether the delivery state moved. Shared by the bulk sync and the one-parcel
 * "Track" button, so the two can never read the same scan differently.
 */
export function applyShipmentUpdate(
  order: { shipment?: ShipmentFields | null; delivery?: { reported?: string }; set: (path: string, value: unknown) => void },
  update: ShipmentFields
): boolean {
  const reported = deliveryStateFrom(update.status, update.statusCode);
  const changed = order.delivery?.reported !== reported;

  order.set("shipment.shiprocketOrderId", update.shiprocketOrderId || order.shipment?.shiprocketOrderId);
  order.set("shipment.shipmentId", update.shipmentId || order.shipment?.shipmentId);
  order.set("shipment.awb", update.awb || order.shipment?.awb);
  order.set("shipment.courier", update.courier || order.shipment?.courier);
  if (update.status) order.set("shipment.status", update.status);
  if (update.statusCode != null) order.set("shipment.statusCode", update.statusCode);
  order.set("shipment.deliveredAt", update.deliveredAt ?? order.shipment?.deliveredAt);
  order.set("shipment.checkedAt", new Date());
  if (update.status) {
    order.set("delivery.reported", reported);
    if (changed) order.set("delivery.at", new Date());
  }
  return Boolean(update.status) && changed;
}

// --------------------------------------------------------------- summaries

export type ExecutiveSummary = {
  executive: { _id: string; name: string; employeeId?: string; active?: boolean };
  orders: number;
  booked: number;
  delivered: number;
  returned: number;
  cancelled: number;
  inTransit: number;
  revenue: number;
  deliveredRevenue: number;
  incentive: { pending: number; payable: number; paid: number; earned: number };
  byMode: Record<string, number>;
  leads?: { assigned: number; converted: number };
};

/**
 * Per-executive totals over a set of orders.
 *
 * One aggregation rather than a loop of counts, because the overview asks it of
 * every executive at once. Every executive appears, including one with nothing
 * yet — a new hire with a blank row is information; a new hire missing from the
 * table reads as somebody nobody set up.
 */
export async function executiveSummaries(match: Record<string, unknown>, onlyExecutive?: string): Promise<ExecutiveSummary[]> {
  const rows = await SalesTeamOrder.aggregate([
    { $match: match },
    {
      $group: {
        _id: "$executive",
        name: { $last: "$executiveName" },
        orders: { $sum: 1 },
        booked: { $sum: { $cond: [{ $ifNull: ["$shipment.awb", false] }, 1, 0] } },
        delivered: { $sum: { $cond: [{ $eq: ["$delivery.state", "Delivered"] }, 1, 0] } },
        returned: { $sum: { $cond: [{ $in: ["$delivery.state", ["RTO", "Returned", "Lost"]] }, 1, 0] } },
        cancelled: { $sum: { $cond: [{ $ifNull: ["$cancelledAt", false] }, 1, 0] } },
        inTransit: { $sum: { $cond: [{ $in: ["$delivery.state", ["In transit", "Undelivered"]] }, 1, 0] } },
        revenue: { $sum: { $cond: [{ $ifNull: ["$cancelledAt", false] }, 0, "$totals.paid"] } },
        deliveredRevenue: { $sum: { $cond: [{ $eq: ["$delivery.state", "Delivered"] }, "$totals.paid", 0] } },
        pending: { $sum: { $cond: [{ $eq: ["$incentive.status", "Pending"] }, "$incentive.amount", 0] } },
        payable: { $sum: { $cond: [{ $eq: ["$incentive.status", "Payable"] }, "$incentive.amount", 0] } },
        paid: { $sum: { $cond: [{ $eq: ["$incentive.status", "Paid"] }, "$incentive.amount", 0] } },
        cod: { $sum: { $cond: [{ $eq: ["$paymentMode", "COD"] }, 1, 0] } },
        prepaid: { $sum: { $cond: [{ $eq: ["$paymentMode", "Prepaid"] }, 1, 0] } },
        partial: { $sum: { $cond: [{ $eq: ["$paymentMode", "Partial"] }, 1, 0] } }
      }
    }
  ]) as Array<Record<string, number> & { _id: Types.ObjectId; name?: string }>;

  const people = await User.find(onlyExecutive ? { _id: onlyExecutive } : { $or: [{ role: "EXECUTIVE" }, { _id: { $in: rows.map(row => row._id) } }] })
    .select("name employeeId active role").sort({ name: 1 }).lean() as unknown as Array<{ _id: Types.ObjectId; name: string; employeeId?: string; active?: boolean; role: string }>;

  const byId = new Map(rows.map(row => [String(row._id), row]));
  const known = new Set(people.map(person => String(person._id)));
  const everyone = [
    ...people.filter(person => person.role === "EXECUTIVE" || byId.has(String(person._id)))
      .map(person => ({ _id: String(person._id), name: person.name, employeeId: person.employeeId, active: person.active !== false })),
    // An order whose executive account was deleted still has a row, under the name it was placed under.
    ...rows.filter(row => !known.has(String(row._id))).map(row => ({ _id: String(row._id), name: row.name ?? "Former executive", active: false }))
  ];

  return everyone.map(executive => {
    const row = byId.get(executive._id);
    const value = (key: string) => Number(row?.[key] ?? 0);
    return {
      executive,
      orders: value("orders"),
      booked: value("booked"),
      delivered: value("delivered"),
      returned: value("returned"),
      cancelled: value("cancelled"),
      inTransit: value("inTransit"),
      revenue: Math.round(value("revenue")),
      deliveredRevenue: Math.round(value("deliveredRevenue")),
      incentive: {
        pending: value("pending"),
        payable: value("payable"),
        paid: value("paid"),
        earned: value("payable") + value("paid")
      },
      byMode: { COD: value("cod"), Prepaid: value("prepaid"), Partial: value("partial") }
    };
  });
}

/** The same totals added up across everybody. */
export function totalOf(summaries: ExecutiveSummary[]) {
  const sum = (pick: (row: ExecutiveSummary) => number) => summaries.reduce((total, row) => total + pick(row), 0);
  return {
    orders: sum(row => row.orders),
    booked: sum(row => row.booked),
    delivered: sum(row => row.delivered),
    returned: sum(row => row.returned),
    cancelled: sum(row => row.cancelled),
    revenue: sum(row => row.revenue),
    deliveredRevenue: sum(row => row.deliveredRevenue),
    incentive: {
      pending: sum(row => row.incentive.pending),
      payable: sum(row => row.incentive.payable),
      paid: sum(row => row.incentive.paid),
      earned: sum(row => row.incentive.earned)
    }
  };
}

/** Whether a user id belongs to an active sales executive — the only people an order can belong to. */
export async function activeExecutive(id: string): Promise<{ _id: Types.ObjectId; name: string; employeeId: string } | null> {
  return await User.findOne({ _id: id, role: "EXECUTIVE", active: true }).select("name employeeId").lean() as { _id: Types.ObjectId; name: string; employeeId: string } | null;
}

// ------------------------------------------------------------------ Shopify

export type ShopifyReadiness = { config: ShopifyConfig | null; refusal?: string };

/**
 * Whether orders can be placed in the shop right now, and if not, the sentence
 * saying who can fix it. A connection made before `write_orders` was added only
 * gains it after a Reconnect, so the scopes actually granted are read rather
 * than assumed. A connection with no record of its scopes is given the benefit
 * of the doubt — Shopify itself refuses if it must, in words placeShopifyOrder
 * turns into the same instruction.
 */
export async function shopifyReadiness(): Promise<ShopifyReadiness> {
  const credentials = await loadCredentials();
  const config = shopifyConfig(credentials);
  if (!config) {
    return { config: null, refusal: "Orders are set to go through Shopify, but Shopify is not connected. An administrator connects it under Affiliate CRM → Settings, or switches the sales team to direct orders under Sales CRM → Settings." };
  }
  if (credentials.shopifyScopes && !canWriteOrders(credentials.shopifyScopes)) {
    // The record may simply be old: scopes are re-read from Shopify before
    // refusing, and the record corrected if the token can in fact write orders.
    const live = await grantedScopes(config).catch(() => null);
    if (live?.length) {
      await SalesSettings.updateOne({ key: "sales" }, { $set: { shopifyScopes: live.join(",") } });
      if (live.includes("write_orders")) return { config };
    }
    return { config: null, refusal: "Shopify is connected but has not been allowed to create orders (write_orders). An administrator adds that permission to the app in the Shopify Dev Dashboard, releases it, then presses Reconnect with Shopify under Affiliate CRM → Settings." };
  }
  return { config };
}

/**
 * Reads open Shopify-placed team orders back from the shop, for the one thing
 * only the shop knows: that somebody cancelled or fully refunded it there. That
 * voids the incentive here at once, rather than waiting for the courier to say
 * "cancelled" — which for an order never booked it never will.
 */
export async function syncTeamShopify(limit = 150): Promise<{ checked: number; cancelled: number }> {
  const { config } = await shopifyReadiness();
  const report = { checked: 0, cancelled: 0 };
  if (!config) return report;

  const since = new Date(Date.now() - 120 * 86_400_000);
  const orders = await SalesTeamOrder.find({
    shopifyOrderId: { $exists: true }, cancelledAt: null, placedAt: { $gte: since },
    "delivery.state": { $nin: ["Delivered", "RTO", "Returned", "Lost"] }
  }).sort({ placedAt: -1 }).limit(limit);

  for (const order of orders) {
    const remote = await fetchOrder(config, order.shopifyOrderId).catch(() => null);
    report.checked++;
    if (!remote) continue;
    if (remote.cancelled_at || remote.financial_status === "refunded" || remote.financial_status === "voided") {
      order.set({ cancelledAt: remote.cancelled_at ? new Date(remote.cancelled_at) : new Date(), cancelReason: remote.cancelled_at ? "Cancelled in Shopify." : "Refunded in full in Shopify." });
      recalculateIncentive(order);
      await order.save();
      report.cancelled++;
    }
  }
  return report;
}
