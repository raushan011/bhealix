import { Schema, model, models } from "mongoose";
import { INTEREST_LEVELS, VISIT_OUTCOMES } from "@/lib/visits";

const SampleSchema = new Schema({
  product: { type: String, required: true },
  quantity: { type: Number, min: 1, required: true }
}, { _id: false });

const VisitSchema = new Schema({
  doctor: { type: Schema.Types.ObjectId, ref: "Doctor", required: true, index: true },
  employee: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  routePlan: { type: Schema.Types.ObjectId, ref: "RoutePlan", index: true },

  plannedDate: { type: Date, required: true, index: true },
  plannedStart: String,
  status: { type: String, enum: ["Planned", "In progress", "Completed", "Missed"], default: "Planned", index: true },

  checkInAt: Date,
  checkOutAt: Date,
  checkInLocation: { latitude: Number, longitude: Number, accuracy: Number },

  outcome: { type: String, enum: VISIT_OUTCOMES },
  productsDiscussed: { type: [String], default: [] },
  samples: { type: [SampleSchema], default: [] },
  interest: { type: String, enum: INTEREST_LEVELS },
  orderValue: { type: Number, min: 0 },
  notes: String,
  followUpDate: Date
}, { timestamps: true });

VisitSchema.index({ employee: 1, plannedDate: -1 });
VisitSchema.index({ doctor: 1, plannedDate: -1 });

export const Visit = models.Visit ?? model("Visit", VisitSchema);
