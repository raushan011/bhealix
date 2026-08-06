import { Types } from "mongoose";
import { Product } from "@/models/Catalog";
import { User } from "@/models/User";
import { SampleMovement } from "@/models/Sample";
import { dispenseRowsFor, type DispensingVisit, type StockRow } from "./movements";

const objectId = (value: unknown) => new Types.ObjectId(String(value));

/**
 * The per-product totals every stock view needs. Written once here because the
 * arithmetic must mean the same thing on the rep's phone and in the admin
 * matrix — see `foldStock` for the same fold expressed in plain TypeScript.
 */
const TOTALS = {
  issued: { $sum: { $cond: [{ $eq: ["$type", "ISSUE"] }, "$quantity", 0] } },
  dispensed: { $sum: { $cond: [{ $eq: ["$type", "DISPENSE"] }, { $abs: "$quantity" }, 0] } },
  returned: { $sum: { $cond: [{ $eq: ["$type", "RETURN"] }, { $abs: "$quantity" }, 0] } },
  adjusted: { $sum: { $cond: [{ $eq: ["$type", "ADJUSTMENT"] }, "$quantity", 0] } },
  balance: { $sum: "$quantity" }
} as const;

/**
 * Rewrites the ledger rows a visit implies.
 *
 * Deliberately delete-then-insert: the visit endpoint will happily accept a
 * second `complete` for a visit that is already completed, and an append would
 * silently double the rep's dispensed count. Replacing the visit's rows makes
 * re-submitting safe, and makes a visit later marked missed give its stock back.
 */
export async function syncDispenseLedger(visit: DispensingVisit): Promise<number> {
  await SampleMovement.deleteMany({ visit: visit._id, type: "DISPENSE" });

  const names = [...new Set((visit.samples ?? []).map(sample => sample?.product).filter(Boolean) as string[])];
  const catalogue = names.length
    ? await Product.find({ name: { $in: names } }).select("name").lean() as unknown as Array<{ _id: unknown; name: string }>
    : [];
  const rows = dispenseRowsFor(visit, new Map(catalogue.map(product => [product.name, product._id])));

  if (rows.length) await SampleMovement.insertMany(rows);
  return rows.length;
}

/** Everything one rep is currently holding, product by product. */
export async function stockFor(employee: unknown): Promise<StockRow[]> {
  return SampleMovement.aggregate<StockRow>([
    { $match: { employee: objectId(employee) } },
    { $group: { _id: "$productName", ...TOTALS } },
    { $project: { _id: 0, product: "$_id", issued: 1, dispensed: 1, returned: 1, adjusted: 1, balance: 1 } },
    { $sort: { product: 1 } }
  ]);
}

export type EmployeeStock = {
  employee: string;
  name: string;
  employeeId: string;
  rows: StockRow[];
  issued: number;
  dispensed: number;
  balance: number;
};

/** The whole field team's stock in one pass, for the administrator's matrix. */
export async function stockByEmployee(): Promise<EmployeeStock[]> {
  const grouped = await SampleMovement.aggregate<{
    _id: { employee: unknown; product: string };
  } & Omit<StockRow, "product">>([
    { $group: { _id: { employee: "$employee", product: "$productName" }, ...TOTALS } },
    { $sort: { "_id.product": 1 } }
  ]);

  const byEmployee = new Map<string, StockRow[]>();
  for (const row of grouped) {
    const key = String(row._id.employee);
    const rows = byEmployee.get(key) ?? [];
    rows.push({
      product: row._id.product,
      issued: row.issued, dispensed: row.dispensed,
      returned: row.returned, adjusted: row.adjusted, balance: row.balance
    });
    byEmployee.set(key, rows);
  }

  if (!byEmployee.size) return [];

  const users = await User.find({ _id: { $in: [...byEmployee.keys()].map(objectId) } })
    .select("name employeeId").lean() as unknown as Array<{ _id: unknown; name: string; employeeId: string }>;

  return users.map(user => {
    const rows = byEmployee.get(String(user._id)) ?? [];
    return {
      employee: String(user._id),
      name: user.name,
      employeeId: user.employeeId,
      rows,
      issued: rows.reduce((sum, row) => sum + row.issued, 0),
      dispensed: rows.reduce((sum, row) => sum + row.dispensed, 0),
      balance: rows.reduce((sum, row) => sum + row.balance, 0)
    };
  }).sort((a, b) => b.issued - a.issued || a.name.localeCompare(b.name));
}

/**
 * Sample movement per rep over a date range, for the reports page.
 *
 * Adjustments are included. Without them the figure derived here disagreed with
 * the Samples screen for any rep whose count had been corrected, and could show
 * a rep as having over-recorded when the shortfall was a stocktake all along.
 */
export async function movementTotalsByEmployee(range: { $gte: Date; $lte: Date }) {
  const rows = await SampleMovement.aggregate<
    { _id: unknown; issued: number; dispensed: number; returned: number; adjusted: number }
  >([
    { $match: { occurredAt: range } },
    {
      $group: {
        _id: "$employee",
        issued: TOTALS.issued, dispensed: TOTALS.dispensed,
        returned: TOTALS.returned, adjusted: TOTALS.adjusted
      }
    }
  ]);
  return new Map(rows.map(row => [String(row._id), row]));
}
