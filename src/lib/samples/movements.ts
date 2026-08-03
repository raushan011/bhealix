/**
 * Sample-stock vocabulary shared by the client forms and the server model.
 * Kept out of the Mongoose file so client bundles never pull in the database layer.
 */

/** Stock only ever moves in one of four ways. */
export const MOVEMENT_TYPES = ["ISSUE", "DISPENSE", "RETURN", "ADJUSTMENT"] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

/** The three an administrator records by hand; DISPENSE is written by the visit log. */
export const MANUAL_MOVEMENT_TYPES = ["ISSUE", "RETURN", "ADJUSTMENT"] as const;
export type ManualMovementType = (typeof MANUAL_MOVEMENT_TYPES)[number];

export const MOVEMENT_LABEL: Record<MovementType, string> = {
  ISSUE: "Issued to rep",
  DISPENSE: "Given to doctor",
  RETURN: "Returned to office",
  ADJUSTMENT: "Adjustment"
};

/**
 * The ledger stores a *signed* quantity, so a balance is a single `$sum` and
 * there is no way to get the direction wrong at read time. Stock arriving with
 * the rep is positive, stock leaving them is negative, and an adjustment goes
 * whichever way the administrator wrote it — a stocktake can find units as
 * easily as it can lose them.
 */
export function signedQuantity(type: MovementType, amount: number): number {
  const size = Math.abs(Math.trunc(amount));
  switch (type) {
    case "ISSUE": return size;
    case "DISPENSE": case "RETURN": return -size;
    case "ADJUSTMENT": return Math.trunc(amount);
  }
}

export type StockRow = {
  product: string;
  issued: number;
  dispensed: number;
  returned: number;
  adjusted: number;
  balance: number;
};

/** A visit as the ledger needs to see it — the subset both the app and the backfill script share. */
export type DispensingVisit = {
  _id: unknown;
  employee: unknown;
  doctor?: unknown;
  status?: string;
  checkOutAt?: Date | null;
  plannedDate?: Date | null;
  samples?: Array<{ product?: string; quantity?: number }> | null;
};

export type DispenseRow = {
  employee: unknown;
  product?: unknown;
  productName: string;
  type: "DISPENSE";
  quantity: number;
  doctor?: unknown;
  visit: unknown;
  actor: unknown;
  occurredAt: Date;
};

/**
 * Turns one visit into the ledger rows it implies. Only a completed visit hands
 * anything over — a visit that was logged and later marked missed produces no
 * rows, which is what makes re-syncing it remove the old ones.
 */
export function dispenseRowsFor(visit: DispensingVisit, productIdByName?: Map<string, unknown>): DispenseRow[] {
  if (visit.status !== "Completed") return [];
  const occurredAt = visit.checkOutAt ?? visit.plannedDate ?? new Date();

  return (visit.samples ?? [])
    .filter((sample): sample is { product: string; quantity: number } =>
      Boolean(sample?.product) && Number(sample?.quantity) > 0)
    .map(sample => ({
      employee: visit.employee,
      product: productIdByName?.get(sample.product),
      productName: sample.product,
      type: "DISPENSE" as const,
      quantity: signedQuantity("DISPENSE", sample.quantity),
      doctor: visit.doctor,
      visit: visit._id,
      // The rep handed the samples over, so the rep is the actor.
      actor: visit.employee,
      occurredAt: new Date(occurredAt)
    }));
}

/**
 * Folds ledger rows into per-product totals. Real queries do this with an
 * aggregation in `ledger.ts`; this is the same arithmetic written plainly, so
 * the rules for what a balance means are stated somewhere a test can reach.
 * Change one and change the other.
 */
export function foldStock(rows: Array<{ productName: string; type: MovementType; quantity: number }>): StockRow[] {
  const totals = new Map<string, StockRow>();

  for (const row of rows) {
    const current = totals.get(row.productName)
      ?? { product: row.productName, issued: 0, dispensed: 0, returned: 0, adjusted: 0, balance: 0 };
    if (row.type === "ISSUE") current.issued += row.quantity;
    else if (row.type === "DISPENSE") current.dispensed += Math.abs(row.quantity);
    else if (row.type === "RETURN") current.returned += Math.abs(row.quantity);
    else current.adjusted += row.quantity;
    current.balance += row.quantity;
    totals.set(row.productName, current);
  }

  return [...totals.values()].sort((a, b) => a.product.localeCompare(b.product));
}

/** How much of what a rep was given has actually reached a doctor. */
export function utilisation(issued: number, dispensed: number): number {
  return issued > 0 ? Math.round((dispensed / issued) * 100) : 0;
}
