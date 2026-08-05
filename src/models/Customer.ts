import { Schema, model, models } from "mongoose";
import { CUSTOMER_TYPES } from "@/lib/billing/constants";

/**
 * A trade buyer: a stockist, a distributor, a chemist, a hospital or a private
 * individual.
 *
 * Deliberately a separate collection from `Doctor` rather than a type on it.
 * A doctor is somebody a representative visits — they carry call windows,
 * visit history and a place on a route plan, none of which mean anything for a
 * distributor. Keeping them apart lets a bill be raised for either without the
 * doctor directory filling up with people nobody is going to call on.
 */
const CustomerSchema = new Schema({
  code: { type: String, required: true, unique: true, index: true },
  type: { type: String, enum: CUSTOMER_TYPES, default: "Stockist", index: true },
  name: { type: String, required: true, index: true },
  /** The trading name, where it differs from the person dealt with. */
  businessName: String,
  contactPerson: String,

  phones: { type: [String], default: [] },
  email: String,

  address: String,
  city: { type: String, index: true },
  state: String,
  /** Decides the place of supply, and with it CGST + SGST against IGST. */
  stateCode: String,
  pinCode: String,

  gstin: String,
  pan: String,
  drugLicenceNo: String,

  /** Default credit period in days for this buyer; a stockist rarely pays on the spot. */
  creditPeriod: { type: Number, default: 0, min: 0 },
  /** Informational: what the business is willing to carry for them. */
  creditLimit: { type: Number, default: 0, min: 0 },

  notes: String,
  active: { type: Boolean, default: true, index: true }
}, { timestamps: true });

CustomerSchema.index({ type: 1, name: 1 });

export const Customer = models.Customer ?? model("Customer", CustomerSchema);
