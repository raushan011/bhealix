import { Schema, model, models } from "mongoose";
import { STOCK_MOVEMENT_TYPES } from "@/lib/inventory/movements";

/**
 * Every movement of company stock is one row. Balances are always derived by
 * summing the signed `quantity`, never stored, so the stock on the shelf cannot
 * drift out of step with the events that produced it — the same design as the
 * per-rep sample ledger, for the same reason.
 *
 * `productName` rather than the reference is the grouping key: the catalogue
 * retires rather than deletes anything still in use, so the name is the value
 * that survives. The `product` reference rides along and may be absent.
 */
const StockMovementSchema = new Schema({
  product: { type: Schema.Types.ObjectId, ref: "Product", index: true },
  productName: { type: String, required: true, index: true },
  type: { type: String, enum: STOCK_MOVEMENT_TYPES, required: true, index: true },
  /** Signed: positive puts stock on the shelf, negative takes it off. */
  quantity: { type: Number, required: true },

  // Set on PURCHASE / OPENING — what a valuation and a recall need.
  unitCost: Number,
  batchNo: String,
  expiryAt: Date,
  supplier: String,
  reference: String,

  // Set on SALE and SALE_RETURN — the invoice that moved it.
  invoice: { type: Schema.Types.ObjectId, ref: "Invoice", index: true },
  // Set on SAMPLE_ISSUE and SAMPLE_RETURN — the rep who took it, and the row in
  // the sample ledger this mirrors.
  employee: { type: Schema.Types.ObjectId, ref: "User" },
  sampleMovement: { type: Schema.Types.ObjectId, ref: "SampleMovement", index: true },

  actor: { type: Schema.Types.ObjectId, ref: "User" },
  occurredAt: { type: Date, required: true, default: Date.now, index: true },
  notes: String
}, { timestamps: true });

StockMovementSchema.index({ productName: 1, occurredAt: -1 });
StockMovementSchema.index({ type: 1, occurredAt: -1 });

export const StockMovement = models.StockMovement ?? model("StockMovement", StockMovementSchema);
