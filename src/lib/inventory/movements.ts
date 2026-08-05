/**
 * Warehouse-stock vocabulary, shared by the admin screens and the server.
 * Kept out of the Mongoose file so client bundles never pull in the database.
 *
 * This ledger counts what the company holds. `lib/samples/movements.ts` counts
 * what an individual representative is carrying — two different questions, so
 * two ledgers. They meet at one point: issuing samples to a rep takes the units
 * out of the warehouse, so a sample issue writes a row in both.
 */

export const STOCK_MOVEMENT_TYPES = [
  "OPENING", "PURCHASE", "SALE", "SALE_RETURN", "SAMPLE_ISSUE", "SAMPLE_RETURN", "ADJUSTMENT"
] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

/** The four an administrator records by hand; the rest are written by the system. */
export const MANUAL_STOCK_TYPES = ["PURCHASE", "OPENING", "SALE_RETURN", "ADJUSTMENT"] as const;
export type ManualStockType = (typeof MANUAL_STOCK_TYPES)[number];

export const STOCK_LABEL: Record<StockMovementType, string> = {
  OPENING: "Opening stock",
  PURCHASE: "Stock received",
  SALE: "Sold (invoiced)",
  SALE_RETURN: "Sales return",
  SAMPLE_ISSUE: "Issued as samples",
  SAMPLE_RETURN: "Samples returned",
  ADJUSTMENT: "Adjustment"
};

/**
 * Signed, exactly as the sample ledger is: a balance is then a single `$sum`
 * and there is no way to get the direction wrong at read time.
 */
export function signedStock(type: StockMovementType, amount: number): number {
  const size = Math.abs(Math.trunc(amount));
  switch (type) {
    case "OPENING": case "PURCHASE": case "SALE_RETURN": case "SAMPLE_RETURN": return size;
    case "SALE": case "SAMPLE_ISSUE": return -size;
    // A stocktake can find units as easily as it can lose them.
    case "ADJUSTMENT": return Math.trunc(amount);
  }
}

export type StockLevel = {
  product: string;
  received: number;
  sold: number;
  sampled: number;
  returned: number;
  adjusted: number;
  balance: number;
};

const EMPTY = (product: string): StockLevel =>
  ({ product, received: 0, sold: 0, sampled: 0, returned: 0, adjusted: 0, balance: 0 });

/**
 * Folds ledger rows into per-product levels. The real queries do this with an
 * aggregation in `ledger.ts`; this is the same arithmetic written plainly so the
 * rules for what a stock level means are stated where a test can reach them.
 * Change one and change the other.
 */
export function foldLevels(rows: Array<{ productName: string; type: StockMovementType; quantity: number }>): StockLevel[] {
  const totals = new Map<string, StockLevel>();

  for (const row of rows) {
    const level = totals.get(row.productName) ?? EMPTY(row.productName);
    if (row.type === "OPENING" || row.type === "PURCHASE") level.received += Math.abs(row.quantity);
    else if (row.type === "SALE") level.sold += Math.abs(row.quantity);
    else if (row.type === "SAMPLE_ISSUE") level.sampled += Math.abs(row.quantity);
    else if (row.type === "SALE_RETURN" || row.type === "SAMPLE_RETURN") level.returned += Math.abs(row.quantity);
    else level.adjusted += row.quantity;
    level.balance += row.quantity;
    totals.set(row.productName, level);
  }

  return [...totals.values()].sort((a, b) => a.product.localeCompare(b.product));
}

/**
 * Turns "this product has 60 units" into the ledger row that makes it true.
 *
 * The catalogue screen offers a plain units-available box, but the number it
 * shows is never stored on the product — it is the balance of this ledger, the
 * same balance billing and sample issues draw down. Typing a new figure records
 * the difference, so the count on the shelf and the events that produced it can
 * never disagree.
 */
export function levelChange(current: number, target: number, hasHistory: boolean):
  { type: "OPENING" | "ADJUSTMENT"; quantity: number } | null {
  const wanted = Math.max(0, Math.trunc(target));
  const delta = wanted - current;
  if (delta === 0) return null;
  // The first count a product is ever given is its opening stock; every later
  // correction is an adjustment, so the history says which of the two it was.
  return { type: hasHistory ? "ADJUSTMENT" : "OPENING", quantity: delta };
}

/** Below the reorder level, or already gone. Zero means the product is not tracked for reordering. */
export function stockAlert(balance: number, reorderLevel = 0): "out" | "low" | null {
  if (balance <= 0) return "out";
  if (reorderLevel > 0 && balance <= reorderLevel) return "low";
  return null;
}
