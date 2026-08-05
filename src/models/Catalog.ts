import { Schema, model, models } from "mongoose";

const ProductSchema = new Schema({
  name: { type: String, required: true, unique: true },
  category: String,
  sampleAvailable: { type: Boolean, default: true },
  active: { type: Boolean, default: true },

  // Commercial details. A product can be sold without them — the invoice form
  // lets any of these be overridden on the line — but filling them in is what
  // makes billing a matter of choosing a product and typing a quantity.
  /** The HSN code the GST return groups this product under. */
  hsnCode: String,
  unit: { type: String, default: "Pcs" },
  /** Default selling rate, read as inclusive or exclusive per the invoice's flag. */
  price: { type: Number, default: 0, min: 0 },
  mrp: { type: Number, default: 0, min: 0 },
  gstRate: { type: Number, default: 18, min: 0 },
  /** Warn on the stock screen once the balance falls to this. Zero means never. */
  reorderLevel: { type: Number, default: 0, min: 0 }
}, { timestamps: true });
export const Product = models.Product ?? model("Product", ProductSchema);

const AuditSchema = new Schema({
  actor: { type: Schema.Types.ObjectId, ref: "User" },
  action: { type: String, required: true, index: true },
  entityType: String,
  entityId: Schema.Types.ObjectId,
  metadata: Schema.Types.Mixed
}, { timestamps: true });
export const AuditEvent = models.AuditEvent ?? model("AuditEvent", AuditSchema);
