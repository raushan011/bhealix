import { Schema, model, models } from "mongoose";
import { MOVEMENT_TYPES } from "@/lib/samples/movements";

/**
 * Every movement of sample stock is one row. Balances are always derived by
 * summing the signed `quantity`, never stored, so a rep's stock on hand cannot
 * drift out of step with the events that produced it.
 *
 * `productName` rather than the product reference is the grouping key: visits
 * record the product as text, and the catalogue retires rather than deletes
 * anything still in use, so the name is the value that survives. The `product`
 * reference is carried alongside for convenience and may be absent.
 */
const SampleMovementSchema = new Schema({
  employee: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  product: { type: Schema.Types.ObjectId, ref: "Product" },
  productName: { type: String, required: true, index: true },
  type: { type: String, enum: MOVEMENT_TYPES, required: true, index: true },
  /** Signed: positive puts stock in the rep's hands, negative takes it out. */
  quantity: { type: Number, required: true },

  // Set on DISPENSE only — where the samples actually went.
  doctor: { type: Schema.Types.ObjectId, ref: "Doctor" },
  visit: { type: Schema.Types.ObjectId, ref: "Visit", index: true },

  // Set on ISSUE only — what a recall or an expiry sweep needs.
  batchNo: String,
  expiryAt: Date,

  actor: { type: Schema.Types.ObjectId, ref: "User" },
  occurredAt: { type: Date, required: true, default: Date.now, index: true },
  notes: String
}, { timestamps: true });

SampleMovementSchema.index({ employee: 1, productName: 1, occurredAt: -1 });
SampleMovementSchema.index({ employee: 1, occurredAt: -1 });
// Both of the above lead with the rep. The desk reads the same ledger across
// everybody, which has no rep to lead with.
SampleMovementSchema.index({ occurredAt: -1, createdAt: -1 });

export const SampleMovement = models.SampleMovement ?? model("SampleMovement", SampleMovementSchema);
