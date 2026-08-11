import { Types } from "mongoose";
import { SalesOrder, SalesRep } from "@/models/Sales";
import { VOID_STATES, type CommissionStatus } from "./constants";
import { emptyEarnings, type RepSummary } from "./types";

/**
 * The figures every sales screen is built from.
 *
 * One aggregation per question rather than a query per rep: a leaderboard of
 * forty affiliates should be one round trip, not forty-one.
 *
 * **Ids are cast.** An `ObjectId` arriving as a string in an aggregation
 * `$match` matches nothing at all and returns zeroes rather than an error
 * (§11) — so every id that reaches a pipeline goes through `Types.ObjectId`.
 */

export type Window = { from?: Date; to?: Date };

const dateMatch = (window: Window) =>
  window.from || window.to
    ? { placedAt: { ...(window.from ? { $gte: window.from } : {}), ...(window.to ? { $lte: window.to } : {}) } }
    : {};

const sumWhen = (field: string, values: readonly string[], value: string | number = 1) =>
  ({ $sum: { $cond: [{ $in: [`$${field}`, values] }, value, 0] } });

const earnedWhen = (status: CommissionStatus) =>
  ({ $sum: { $cond: [{ $eq: ["$commission.status", status] }, "$commission.amount", 0] } });

type Grouped = {
  _id: unknown;
  orders: number;
  delivered: number;
  inTransit: number;
  returned: number;
  revenue: number;
  Pending: number;
  Maturing: number;
  Payable: number;
  "In payout": number;
  Paid: number;
  Void: number;
};

const GROUP = {
  orders: { $sum: 1 },
  delivered: sumWhen("delivery.state", ["Delivered"]),
  inTransit: sumWhen("delivery.state", ["Awaiting", "In transit", "Undelivered"]),
  returned: sumWhen("delivery.state", VOID_STATES),
  // What the customers actually paid on attributed orders — the top line the
  // affiliate scheme brought in, not what anybody was paid out of it.
  revenue: { $sum: "$totals.paid" },
  Pending: earnedWhen("Pending"),
  Maturing: earnedWhen("Maturing"),
  Payable: earnedWhen("Payable"),
  "In payout": earnedWhen("In payout"),
  Paid: earnedWhen("Paid"),
  Void: earnedWhen("Void")
} as const;

/** Every rep, with what they have done in the window. Reps with no orders are included, at zero. */
export async function repSummaries(window: Window = {}, options: { activeOnly?: boolean } = {}): Promise<RepSummary[]> {
  const reps = await SalesRep.find(options.activeOnly ? { active: true } : {})
    .sort({ name: 1 })
    .select("name code active phone")
    .lean() as { _id: unknown; name?: string; code?: string; active?: boolean; phone?: string }[];

  const grouped = await SalesOrder.aggregate<Grouped>([
    { $match: { rep: { $ne: null }, ...dateMatch(window) } },
    { $group: { _id: "$rep", ...GROUP } }
  ]);

  const byRep = new Map(grouped.map(row => [String(row._id), row]));

  return reps.map(rep => {
    const row = byRep.get(String(rep._id));
    const earned = emptyEarnings();
    if (row) for (const status of Object.keys(earned) as CommissionStatus[]) earned[status] = row[status] ?? 0;

    return {
      rep: { _id: String(rep._id), name: rep.name ?? "", code: rep.code ?? "", active: rep.active !== false, phone: rep.phone },
      orders: row?.orders ?? 0,
      delivered: row?.delivered ?? 0,
      inTransit: row?.inTransit ?? 0,
      returned: row?.returned ?? 0,
      revenue: Math.round(row?.revenue ?? 0),
      earned,
      payable: earned.Payable,
      paid: earned.Paid
    };
  });
}

/** One rep's figures, over the whole of their history. */
export async function repSummary(repId: string): Promise<RepSummary | null> {
  const summaries = await repSummaries();
  return summaries.find(summary => summary.rep._id === repId) ?? null;
}

export type SalesOverview = {
  window: { from?: string; to?: string };
  orders: number;
  delivered: number;
  inTransit: number;
  returned: number;
  revenue: number;
  earned: Record<CommissionStatus, number>;
  /** Delivered out of everything that has stopped moving — RTO is the number that hurts. */
  deliveryRate: number | null;
  activeReps: number;
  /** Orders whose commission was promised and whose parcel then came back. */
  needsAttention: number;
  top: RepSummary[];
};

export async function salesOverview(window: Window = {}): Promise<SalesOverview> {
  const [totals] = await SalesOrder.aggregate<Grouped>([
    { $match: { rep: { $ne: null }, ...dateMatch(window) } },
    { $group: { _id: null, ...GROUP } }
  ]);

  const earned = emptyEarnings();
  if (totals) for (const status of Object.keys(earned) as CommissionStatus[]) earned[status] = totals[status] ?? 0;

  const [activeReps, needsAttention, summaries] = await Promise.all([
    SalesRep.countDocuments({ active: true }),
    SalesOrder.countDocuments({ "commission.needsReversal": true }),
    repSummaries(window)
  ]);

  const settled = (totals?.delivered ?? 0) + (totals?.returned ?? 0);

  return {
    window: { from: window.from?.toISOString(), to: window.to?.toISOString() },
    orders: totals?.orders ?? 0,
    delivered: totals?.delivered ?? 0,
    inTransit: totals?.inTransit ?? 0,
    returned: totals?.returned ?? 0,
    revenue: Math.round(totals?.revenue ?? 0),
    earned,
    deliveryRate: settled ? Math.round(((totals?.delivered ?? 0) / settled) * 100) : null,
    activeReps,
    needsAttention,
    top: summaries.filter(summary => summary.orders > 0).sort((a, b) => b.revenue - a.revenue).slice(0, 5)
  };
}

/** The commission rows behind one rep's figures, newest first. */
export async function ordersForRep(repId: string, limit = 100) {
  return await SalesOrder.find({ rep: new Types.ObjectId(repId) })
    .sort({ placedAt: -1 })
    .limit(limit)
    .lean();
}
