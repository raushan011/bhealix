import { Types } from "mongoose";
import { Product } from "@/models/Catalog";
import { StockMovement } from "@/models/Inventory";
import { SampleMovement } from "@/models/Sample";
import { unitsSupplied } from "@/lib/billing/gst";
import { levelChange, stockAlert, type StockLevel } from "./movements";

/**
 * The per-product totals every stock view needs. Written once because the
 * arithmetic must mean the same thing on the inventory screen and in the
 * availability check the invoice form runs — see `foldLevels` for the same fold
 * expressed in plain TypeScript.
 */
const TOTALS = {
  received: { $sum: { $cond: [{ $in: ["$type", ["OPENING", "PURCHASE"]] }, { $abs: "$quantity" }, 0] } },
  sold: { $sum: { $cond: [{ $eq: ["$type", "SALE"] }, { $abs: "$quantity" }, 0] } },
  sampled: { $sum: { $cond: [{ $eq: ["$type", "SAMPLE_ISSUE"] }, { $abs: "$quantity" }, 0] } },
  returned: { $sum: { $cond: [{ $in: ["$type", ["SALE_RETURN", "SAMPLE_RETURN"]] }, { $abs: "$quantity" }, 0] } },
  adjusted: { $sum: { $cond: [{ $eq: ["$type", "ADJUSTMENT"] }, "$quantity", 0] } },
  balance: { $sum: "$quantity" }
} as const;

export type ProductStock = StockLevel & {
  productId?: string;
  category?: string;
  unit?: string;
  hsnCode?: string;
  price: number;
  gstRate: number;
  reorderLevel: number;
  /** Value of what is on the shelf at the selling rate. */
  stockValue: number;
  alert: "out" | "low" | null;
};

const EMPTY_LEVEL = { received: 0, sold: 0, sampled: 0, returned: 0, adjusted: 0, balance: 0 };

/**
 * Stock levels for the whole catalogue.
 *
 * Driven from the catalogue rather than from the ledger, so a product nobody has
 * received yet still appears — showing zero is what tells an administrator to go
 * and enter its opening stock. A product that has left the catalogue but still
 * carries a balance is appended, so stock can never hide behind a retirement.
 */
export async function stockLevels(): Promise<ProductStock[]> {
  const [products, grouped] = await Promise.all([
    Product.find({}).select("name category unit hsnCode price gstRate reorderLevel active").sort({ name: 1 }).lean() as
      unknown as Promise<Array<{
        _id: unknown; name: string; category?: string; unit?: string; hsnCode?: string;
        price?: number; gstRate?: number; reorderLevel?: number; active?: boolean;
      }>>,
    StockMovement.aggregate<{ _id: string } & typeof EMPTY_LEVEL>([
      { $group: { _id: "$productName", ...TOTALS } }
    ])
  ]);

  const byName = new Map(grouped.map(row => [row._id, row]));

  const rows: ProductStock[] = products.map(product => {
    const level = byName.get(product.name) ?? EMPTY_LEVEL;
    byName.delete(product.name);
    const price = product.price ?? 0;
    return {
      product: product.name,
      productId: String(product._id),
      category: product.category,
      unit: product.unit,
      hsnCode: product.hsnCode,
      price,
      gstRate: product.gstRate ?? 0,
      reorderLevel: product.reorderLevel ?? 0,
      received: level.received, sold: level.sold, sampled: level.sampled,
      returned: level.returned, adjusted: level.adjusted, balance: level.balance,
      stockValue: Math.round(Math.max(0, level.balance) * price * 100) / 100,
      alert: stockAlert(level.balance, product.reorderLevel ?? 0)
    };
  });

  // Anything still holding stock under a name the catalogue no longer carries.
  for (const [name, level] of byName) {
    rows.push({
      product: name, price: 0, gstRate: 0, reorderLevel: 0,
      received: level.received, sold: level.sold, sampled: level.sampled,
      returned: level.returned, adjusted: level.adjusted, balance: level.balance,
      stockValue: 0, alert: stockAlert(level.balance, 0)
    });
  }

  return rows.sort((a, b) => a.product.localeCompare(b.product));
}

/** Just the balances, keyed by product name — what an availability check needs. */
export async function balancesByProduct(names?: string[]): Promise<Map<string, number>> {
  const rows = await StockMovement.aggregate<{ _id: string; balance: number }>([
    ...(names?.length ? [{ $match: { productName: { $in: names } } }] : []),
    { $group: { _id: "$productName", balance: { $sum: "$quantity" } } }
  ]);
  return new Map(rows.map(row => [row._id, row.balance]));
}

/**
 * Rewrites the stock rows an invoice implies.
 *
 * Deliberately delete-then-insert, exactly as the sample ledger does for a
 * visit: re-saving an invoice cannot double-count it, and cancelling one puts
 * the goods back on the shelf simply by writing no rows.
 */
export async function syncInvoiceStock(invoice: {
  _id: unknown;
  items?: Array<{ product?: unknown; name: string; quantity: number; freeQuantity?: number }> | null;
  status?: string;
  invoiceDate?: Date | null;
  createdBy?: unknown;
}): Promise<number> {
  await StockMovement.deleteMany({ invoice: invoice._id, type: "SALE" });
  if (invoice.status === "Cancelled") return 0;

  const rows = (invoice.items ?? [])
    // Scheme goods are charged for nothing and come off the same shelf, so the
    // shelf is drawn down by both figures — a line that is *only* free goods
    // still moves stock.
    .map(item => ({ item, supplied: unitsSupplied(item) }))
    .filter(({ item, supplied }) => item?.name && supplied > 0)
    .map(({ item, supplied }) => ({
      product: item.product ?? undefined,
      productName: item.name,
      type: "SALE" as const,
      quantity: -supplied,
      invoice: invoice._id,
      actor: invoice.createdBy,
      occurredAt: invoice.invoiceDate ?? new Date()
    }));

  if (rows.length) await StockMovement.insertMany(rows);
  return rows.length;
}

/**
 * Sets a product's units available to a stated figure, writing the difference
 * to the ledger.
 *
 * This is what the plain units box on the catalogue screen saves. The figure is
 * never stored on the product: it is this ledger's balance, the very balance
 * that billing and sample issues draw down, so there is one pool and one number
 * rather than two that drift apart.
 */
export async function setStockLevel(input: {
  productId?: unknown; productName: string; target: number; actor: unknown; notes?: string;
}): Promise<{ changed: boolean; from: number; to: number } | null> {
  const [current] = await StockMovement.aggregate<{ balance: number; rows: number }>([
    { $match: { productName: input.productName } },
    { $group: { _id: null, balance: { $sum: "$quantity" }, rows: { $sum: 1 } } }
  ]);
  const balance = current?.balance ?? 0;

  const change = levelChange(balance, input.target, Boolean(current?.rows));
  if (!change) return { changed: false, from: balance, to: balance };

  await StockMovement.create({
    product: input.productId,
    productName: input.productName,
    type: change.type,
    quantity: change.quantity,
    actor: input.actor,
    occurredAt: new Date(),
    notes: input.notes ?? "Counted from the product catalogue"
  });

  return { changed: true, from: balance, to: balance + change.quantity };
}

/**
 * Carries a product's ledgers over when it is renamed.
 *
 * Both stock ledgers are keyed by product name, so a rename without this would
 * split one pool in two: the old balance stranded under a name nothing points
 * at any more, and the product showing zero. Invoices and visits are left
 * alone on purpose — those record what a document said at the time, and a
 * later rename does not change what was billed or discussed.
 */
export async function renameProductInLedgers(from: string, to: string): Promise<number> {
  if (!from || !to || from === to) return 0;
  const [stock, samples] = await Promise.all([
    StockMovement.updateMany({ productName: from }, { $set: { productName: to } }),
    SampleMovement.updateMany({ productName: from }, { $set: { productName: to } })
  ]);
  return (stock.modifiedCount ?? 0) + (samples.modifiedCount ?? 0);
}

/** Mirrors a rep's sample issue or return against the warehouse it came out of. */
export async function mirrorSampleMovements(rows: Array<{
  _id: unknown; product?: unknown; productName: string; type: string;
  quantity: number; employee: unknown; actor?: unknown; occurredAt: Date; notes?: string;
}>): Promise<number> {
  const mirrored = rows
    .filter(row => row.type === "ISSUE" || row.type === "RETURN")
    .map(row => ({
      product: row.product,
      productName: row.productName,
      // Stock leaving for a rep's bag is off the shelf; stock coming back is on it.
      type: row.type === "ISSUE" ? "SAMPLE_ISSUE" as const : "SAMPLE_RETURN" as const,
      quantity: row.type === "ISSUE" ? -Math.abs(row.quantity) : Math.abs(row.quantity),
      employee: row.employee,
      sampleMovement: row._id,
      actor: row.actor,
      occurredAt: row.occurredAt,
      notes: row.notes
    }));

  if (mirrored.length) await StockMovement.insertMany(mirrored);
  return mirrored.length;
}

export const objectId = (value: unknown) => new Types.ObjectId(String(value));
