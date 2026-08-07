import { Schema, model, models } from "mongoose";
import { completePoint } from "@/lib/doctors/location";

/**
 * A doctor's weekly availability for medical-rep calls. Embedded rather than a
 * separate collection: it is at most seven small entries, it is always read with
 * the doctor, and route planning needs it on every doctor in one query.
 */
const CallWindowSchema = new Schema({
  weekday: { type: Number, min: 0, max: 6, required: true },
  slots: [{ _id: false, start: { type: String, required: true }, end: { type: String, required: true } }],
  appointmentRequired: { type: Boolean, default: false },
  remarks: String,
  updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  updatedAt: Date
}, { _id: false });

const DoctorSchema = new Schema({
  code: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true, index: true },
  specialties: { type: [String], default: [] },
  clinicName: String,

  phones: { type: [String], default: [] },
  email: String,
  website: String,

  fullAddress: String,
  area: { type: String, index: true },
  city: { type: String, index: true },
  pinCode: String,
  // Billing identity. Captured the first time an invoice is raised and reused
  // afterwards, so the second bill for a doctor needs no retyping. `state` also
  // decides the place of supply, and with it CGST + SGST against IGST.
  state: String,
  stateCode: String,
  gstin: String,
  /*
   * No `default: "Point"` on the type. A default there is written even when
   * nothing else about the location is, leaving `{ type: "Point" }` with no
   * coordinates — which the 2dsphere index below refuses outright ("Can't
   * extract geo keys … Point must be an array or object"), so the whole insert
   * fails. A doctor added by hand, or by a rep with location switched off, has
   * no coordinates yet and must still save. The hook under the schema puts the
   * type back whenever there is a real pair to go with it.
   */
  location: {
    type: { type: String, enum: ["Point"] },
    coordinates: { type: [Number], default: undefined }   // [longitude, latitude]
  },

  googlePlaceId: { type: String, index: true, sparse: true },
  googleMapsUrl: String,
  rating: Number,
  reviewCount: Number,
  source: { type: String, enum: ["Google", "Excel", "Manual"], default: "Manual" },

  callSchedule: { type: [CallWindowSchema], default: [] },
  callTimeVerifiedAt: Date,

  priority: { type: String, enum: ["Hot", "High", "Medium", "Low"], default: "Medium" },
  stage: { type: String, enum: ["New", "Contacted", "Interested", "Prescribing", "Not interested"], default: "New", index: true },
  status: { type: String, enum: ["Active", "Archived"], default: "Active", index: true },

  assignedTo: { type: Schema.Types.ObjectId, ref: "User", index: true },
  notes: String,
  lastVisitedAt: Date
}, { timestamps: true });

/*
 * Every write goes through one of these two hooks, so neither a save nor an
 * update can leave half a point behind for the 2dsphere index to choke on —
 * see lib/doctors/location for why that matters.
 */
DoctorSchema.pre("save", function (next) {
  const location = completePoint(this.get("location"));
  // `undefined` rather than a delete: it is what unsets a path on an existing
  // document, and Mongoose's minimize drops it from a new one.
  this.set("location", location);
  next();
});

DoctorSchema.pre(["updateOne", "findOneAndUpdate", "updateMany"], function (next) {
  const update = this.getUpdate();
  // An aggregation-pipeline update is nobody's here; leave it untouched.
  if (!update || Array.isArray(update)) return next();

  // A `location` can arrive at the top of the update or inside `$set` — the
  // hook runs before Mongoose folds the loose keys into one, so both are real.
  for (const holder of [update, update.$set, update.$setOnInsert] as Array<Record<string, unknown> | undefined>) {
    if (!holder || !("location" in holder)) continue;
    const location = completePoint(holder.location);
    if (location) holder.location = location;
    else delete holder.location;
  }
  next();
});

DoctorSchema.index({ location: "2dsphere" });
DoctorSchema.index({ "callSchedule.weekday": 1 });

export const Doctor = models.Doctor ?? model("Doctor", DoctorSchema);
