import { Types } from "mongoose";
import { Counter } from "@/models/Settings";
import { SalesOrder, SalesPayout, SalesPayoutLine, SalesRep } from "@/models/Sales";
import { recalculateCommission } from "./commission";
import { endOfDay, formatPayoutNo, netOfLine, payoutFinancialYear, payoutTotals, type PayoutPeriod } from "./payouts";
import { holdDaysOf, loadCredentials, rulesOf } from "./settings";

/**
 * Assembling and settling a week's payouts.
 *
 * The state machine is payroll's, deliberately: `Draft → Approved → Paid`, with
 * `Approved → Draft` allowed and **Paid terminal**. Money that has left the
 * company is corrected by a later entry, never by rewriting the run that sent it.
 *
 * The one thing worth reading closely is how a run *claims* its commissions —
 * see `savePayoutRun`.
 */

type RunLike = { _id: unknown; status?: string; to?: string; holdDays?: number };

/** `PO/2026-27/0004`, claimed with an atomic `$inc` so two runs can never share one. */
export async function nextPayoutNumber(date = new Date()): Promise<{ payoutNo: string; financialYear: string }> {
  const financialYear = payoutFinancialYear(date);
  const counter = await Counter.findOneAndUpdate(
    { key: `sales-payout:${financialYear}` },
    { $inc: { value: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean() as unknown as { value: number };

  return { payoutNo: formatPayoutNo(financialYear, counter.value), financialYear };
}

/**
 * Everything a run should sweep up, by the day it closes.
 *
 * `Maturing` is in the list beside `Payable`, and that is not sloppiness — it is
 * what makes the payout independent of when anybody last recalculated.
 *
 * A commission becomes payable by the passage of time: nothing happens to the
 * order, the seventh day simply arrives. If the run asked only for rows already
 * *stored* as `Payable`, a commission that matured overnight would be invisible
 * until something happened to recompute it, and the rep would silently wait a
 * week for money they were already owed. Matching on the maturity date instead
 * means the question is answered by the clock rather than by whether a job ran.
 */
const matured = (to: string) => ({
  "commission.status": { $in: ["Maturing", "Payable"] },
  "commission.maturesAt": { $lte: endOfDay(to) },
  rep: { $ne: null }
});

export type PreviewLine = {
  rep: { _id: string; name: string; code: string; payMethod?: string; upiId?: string };
  orders: { _id: string; name?: string; placedAt?: Date; deliveredAt?: Date; base: number; rate: number; amount: number }[];
  orderCount: number;
  gross: number;
};

/**
 * What a run would contain, without writing anything.
 *
 * Note the period's `from` does not bound the query. A run sweeps up everything
 * that has matured and that no run has claimed, however long ago it matured —
 * so a commission missed by an earlier run because of a late delivery update is
 * caught by the next one rather than stranded forever.
 */
export async function previewPayout(period: PayoutPeriod): Promise<{ lines: PreviewLine[]; totals: ReturnType<typeof payoutTotals> }> {
  const orders = await SalesOrder.find(matured(period.to))
    .populate("rep", "name code payMethod upiId active").lean() as PayableOrder[];

  return summarise(orders);
}

type PayableOrder = {
  _id: unknown;
  name?: string;
  placedAt?: Date;
  shipment?: { deliveredAt?: Date };
  rep?: { _id: unknown; name?: string; code?: string; payMethod?: string; upiId?: string } | null;
  commission?: { base?: number; rate?: number; amount?: number };
};

function summarise(orders: PayableOrder[]) {
  const byRep = new Map<string, PreviewLine>();

  for (const order of orders) {
    if (!order.rep?._id) continue;
    const repId = String(order.rep._id);

    const line = byRep.get(repId) ?? {
      rep: { _id: repId, name: order.rep.name ?? "", code: order.rep.code ?? "", payMethod: order.rep.payMethod, upiId: order.rep.upiId },
      orders: [], orderCount: 0, gross: 0
    };

    line.orders.push({
      _id: String(order._id),
      name: order.name,
      placedAt: order.placedAt,
      deliveredAt: order.shipment?.deliveredAt,
      base: order.commission?.base ?? 0,
      rate: order.commission?.rate ?? 0,
      amount: order.commission?.amount ?? 0
    });
    line.orderCount++;
    line.gross += order.commission?.amount ?? 0;
    byRep.set(repId, line);
  }

  const lines = [...byRep.values()].sort((a, b) => b.gross - a.gross);
  return { lines, totals: payoutTotals(lines.map(line => ({ orderCount: line.orderCount, gross: line.gross, net: line.gross }))) };
}

/**
 * Creates the run and claims its commissions.
 *
 * The claim is a single conditional `updateMany`, and that ordering is the whole
 * safety of it. Two administrators pressing Generate at the same moment would
 * otherwise both read the same payable orders and write two runs that each
 * promise the same money. Because the update matches only on
 * `status: "Payable"`, whichever request reaches the database first takes them;
 * the second matches nothing and produces an empty run, which is obvious on
 * screen and harmless.
 *
 * The lines are then built from what was *actually* claimed, never from what was
 * read beforehand.
 */
export async function savePayoutRun(period: PayoutPeriod, actorId: string) {
  const settings = await loadCredentials();
  const holdDays = holdDaysOf(settings);
  const rules = rulesOf(settings);

  // Re-price the candidates before committing to any of them. Two things can
  // have moved since they were last touched: a window that has quietly elapsed
  // (making them payable), and a parcel that has come back (making them void).
  // Doing this first means the claim below settles a set that is already
  // correct, rather than promising money on a stale figure.
  const candidates = await SalesOrder.find(matured(period.to));
  for (const order of candidates) {
    recalculateCommission(order, rules, { holdDays });
    await order.save();
  }

  const { payoutNo, financialYear } = await nextPayoutNumber();

  const run = await SalesPayout.create({
    payoutNo, financialYear,
    from: period.from, to: period.to,
    status: "Draft",
    holdDays,
    generatedBy: actorId,
    generatedAt: new Date()
  });

  // The claim itself matches only `Payable`, so anything the pass above voided
  // is left behind.
  await SalesOrder.updateMany(
    { "commission.status": "Payable", "commission.maturesAt": { $lte: endOfDay(period.to) }, rep: { $ne: null } },
    { $set: { "commission.status": "In payout", "commission.payout": run._id } }
  );

  const claimed = await SalesOrder.find({ "commission.payout": run._id })
    .populate("rep", "name code payMethod upiId phone bankName bankAccountNo panNumber")
    .lean() as (PayableOrder & { rep?: { phone?: string; bankName?: string; bankAccountNo?: string; panNumber?: string } | null })[];

  const { lines, totals } = summarise(claimed);
  const reps = new Map((await SalesRep.find({ _id: { $in: lines.map(line => new Types.ObjectId(line.rep._id)) } }).lean() as RepDoc[])
    .map(rep => [String(rep._id), rep]));

  await SalesPayoutLine.insertMany(lines.map(line => {
    const rep = reps.get(line.rep._id);
    return {
      run: run._id,
      rep: new Types.ObjectId(line.rep._id),
      snapshot: {
        name: rep?.name, code: rep?.code, phone: rep?.phone,
        payMethod: rep?.payMethod, upiId: rep?.upiId, bankName: rep?.bankName,
        // Only the last four are ever shown on an advice, so only those are kept.
        bankAccountLastFour: rep?.bankAccountNo ? String(rep.bankAccountNo).slice(-4) : undefined,
        panNumber: rep?.panNumber
      },
      orders: line.orders.map(order => ({
        order: new Types.ObjectId(order._id),
        name: order.name, placedAt: order.placedAt, deliveredAt: order.deliveredAt,
        base: order.base, rate: order.rate, amount: order.amount
      })),
      orderCount: line.orderCount,
      gross: line.gross,
      adjustments: [],
      net: line.gross
    };
  }));

  run.totals = totals;
  await run.save();
  return run;
}

type RepDoc = {
  _id: unknown; name?: string; code?: string; phone?: string;
  payMethod?: string; upiId?: string; bankName?: string; bankAccountNo?: string; panNumber?: string;
};

/** A run's totals, re-derived from its lines. Called after any line is adjusted. */
export async function refreshRunTotals(runId: unknown) {
  const lines = await SalesPayoutLine.find({ run: runId }).select("orderCount gross net").lean() as
    { orderCount?: number; gross?: number; net?: number }[];
  await SalesPayout.updateOne({ _id: runId }, { $set: { totals: payoutTotals(lines) } });
}

/** Applies an adjustment to one rep's line and re-nets it. */
export async function adjustLine(lineId: string, adjustments: { name: string; amount: number }[], note?: string) {
  const line = await SalesPayoutLine.findById(lineId);
  if (!line) return null;
  line.adjustments = adjustments;
  line.net = netOfLine(line.gross, adjustments);
  if (note !== undefined) line.note = note;
  await line.save();
  await refreshRunTotals(line.run);
  return line;
}

/**
 * Hands a run's commissions back and re-prices them.
 *
 * Re-pricing is the point, not a tidy-up: an order that went RTO while the run
 * sat in draft has to come back as `Void` and not as payable money waiting for
 * the next run to pick up again.
 */
export async function releaseRun(runId: unknown) {
  // The ids are taken first: once the pointer is unset there is no way left to
  // ask which orders this run had, and re-pricing every payable order in the
  // database instead would be both wasteful and wrong.
  const ids = (await SalesOrder.find({ "commission.payout": runId }).select("_id").lean() as { _id: unknown }[])
    .map(order => order._id);
  if (!ids.length) return;

  await SalesOrder.updateMany(
    { _id: { $in: ids } },
    { $set: { "commission.status": "Payable" }, $unset: { "commission.payout": "" } }
  );

  const settings = await loadCredentials();
  const rules = rulesOf(settings);
  const holdDays = holdDaysOf(settings);

  const released = await SalesOrder.find({ _id: { $in: ids } });
  for (const order of released) {
    recalculateCommission(order, rules, { holdDays });
    await order.save();
  }
}

export async function approveRun(run: RunLike, actorId: string) {
  await SalesPayout.updateOne({ _id: run._id }, { $set: { status: "Approved", approvedBy: actorId, approvedAt: new Date() } });
}

export async function reopenRun(run: RunLike) {
  await SalesPayoutLine.deleteMany({ run: run._id });
  await releaseRun(run._id);
  await SalesPayout.updateOne({ _id: run._id }, {
    $set: { status: "Draft", totals: { reps: 0, orders: 0, gross: 0, net: 0 } },
    $unset: { approvedBy: "", approvedAt: "" }
  });
}

export async function payRun(run: RunLike, actorId: string, payment: { paymentDate: string; paymentMode: string; reference?: string }) {
  await SalesPayout.updateOne({ _id: run._id }, {
    $set: { status: "Paid", paidBy: actorId, paidAt: new Date(), ...payment }
  });
  await SalesOrder.updateMany({ "commission.payout": run._id }, { $set: { "commission.status": "Paid" } });
}

/** Drafts only. The commissions go back to payable and are re-priced on the way. */
export async function deleteRun(run: RunLike) {
  await SalesPayoutLine.deleteMany({ run: run._id });
  await releaseRun(run._id);
  await SalesPayout.deleteOne({ _id: run._id });
}

export const canEditRun = (status?: string) => status === "Draft";
export const canReopenRun = (status?: string) => status === "Approved";
export const canPayRun = (status?: string) => status === "Approved";
