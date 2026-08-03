import { Schema, model, models } from "mongoose";

const ProductSchema = new Schema({
  name: { type: String, required: true, unique: true },
  category: String,
  sampleAvailable: { type: Boolean, default: true },
  active: { type: Boolean, default: true }
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
