import { Schema, model, models } from "mongoose";

const StopSchema = new Schema({
  doctor: { type: Schema.Types.ObjectId, ref: "Doctor", required: true },
  sequence: { type: Number, required: true },
  distanceFromPreviousKm: { type: Number, default: 0 },
  plannedStart: String,           // "14:00" — when the meeting should begin
  plannedEnd: String,
  withinCallTime: { type: Boolean, default: true },
  timingUnknown: { type: Boolean, default: false }
}, { _id: false });

/**
 * Where the day started, when it was not a doctor. Absent means the day
 * started at the first stop, as every plan did before this existed — so an
 * old plan and one somebody built starting from a doctor both read the same
 * way: stop one *is* the start.
 */
const OriginSchema = new Schema({
  kind: { type: String, enum: ["location", "home", "custom"], required: true },
  label: { type: String, required: true },
  location: {
    type: { type: String, enum: ["Point"], default: "Point" },
    coordinates: { type: [Number], required: true }
  }
}, { _id: false });

const RoutePlanSchema = new Schema({
  name: { type: String, required: true },
  date: { type: Date, required: true, index: true },
  weekday: { type: Number, min: 0, max: 6, required: true },
  startTime: { type: String, default: "09:30" },
  visitMinutes: { type: Number, default: 45 },
  origin: OriginSchema,

  stops: { type: [StopSchema], default: [] },
  totalDistanceKm: { type: Number, default: 0 },
  totalTravelMinutes: { type: Number, default: 0 },

  assignedTo: { type: Schema.Types.ObjectId, ref: "User", index: true },
  createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  status: { type: String, enum: ["Draft", "Assigned", "In progress", "Completed"], default: "Draft", index: true }
}, { timestamps: true });

RoutePlanSchema.index({ assignedTo: 1, date: -1 });
// Upcoming plans on the dashboard, and the plans list itself. One entry serves
// both directions of sort — an index can be walked either way.
RoutePlanSchema.index({ date: -1 });

export const RoutePlan = models.RoutePlan ?? model("RoutePlan", RoutePlanSchema);
