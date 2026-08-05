import { Schema, model, models } from "mongoose";

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
  location: {
    type: { type: String, enum: ["Point"], default: "Point" },
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

DoctorSchema.index({ location: "2dsphere" });
DoctorSchema.index({ "callSchedule.weekday": 1 });

export const Doctor = models.Doctor ?? model("Doctor", DoctorSchema);
