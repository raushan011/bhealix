import { Schema, model, models } from "mongoose";

/** A stop as it was pinned when the list was saved — not a live doctor lookup. */
const SavedPointSchema = new Schema({
  label: { type: String, required: true },
  sublabel: String,
  latitude: { type: Number, required: true },
  longitude: { type: Number, required: true },
  // Kept for reference only; a doctor removed or moved after saving does not
  // invalidate the list; the coordinates above are what actually get used.
  doctorId: { type: Schema.Types.ObjectId, ref: "Doctor" }
}, { _id: false });

/**
 * A personal, reusable list of stops built with the distance finder — the
 * points and the order they were arranged in, so either panel can reopen it
 * without re-adding every doctor by hand.
 */
const SavedRouteSchema = new Schema({
  name: { type: String, required: true, trim: true },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  points: { type: [SavedPointSchema], default: [] },
  sortMode: { type: String, enum: ["manual", "fromStart", "optimized"], default: "manual" }
}, { timestamps: true });

SavedRouteSchema.index({ createdBy: 1, updatedAt: -1 });

export const SavedRoute = models.SavedRoute ?? model("SavedRoute", SavedRouteSchema);
