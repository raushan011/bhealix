import { Schema, model, models } from "mongoose";
import { DEFAULT_INVOICE_PREFIX } from "@/lib/billing/numbering";

/**
 * The seller's own details, as they must appear on a tax invoice. One document,
 * found by `key`, rather than environment variables: an accountant changes a
 * GSTIN or a bank account without a redeploy.
 */
const BillingSettingsSchema = new Schema({
  key: { type: String, default: "billing", unique: true, index: true },

  legalName: { type: String, default: "BHEALIX" },
  tradeName: String,
  address: String,
  city: String,
  /** The seller's state decides CGST + SGST against IGST for every invoice. */
  state: String,
  stateCode: String,
  pinCode: String,
  gstin: String,
  pan: String,
  phone: String,
  email: String,
  website: String,
  drugLicenceNo: String,

  bankName: String,
  bankAccountName: String,
  bankAccountNo: String,
  bankIfsc: String,
  upiId: String,

  invoicePrefix: { type: String, default: DEFAULT_INVOICE_PREFIX },
  /** Default credit period in days, used to propose a due date. */
  defaultPaymentTerms: { type: Number, default: 0 },
  defaultGstRate: { type: Number, default: 18 },
  /** Whether prices are typed as what the doctor pays, tax already inside. */
  ratesIncludeTax: { type: Boolean, default: false },
  terms: String,
  signatoryName: String
}, { timestamps: true });

export const BillingSettings = models.BillingSettings ?? model("BillingSettings", BillingSettingsSchema);

/**
 * Invoice numbers must never repeat, and two administrators can press Save at
 * the same moment. `$inc` inside `findOneAndUpdate` is atomic in MongoDB, so the
 * number is claimed by the database rather than by a read-then-write that two
 * requests can both win.
 */
const CounterSchema = new Schema({
  key: { type: String, required: true, unique: true, index: true },
  value: { type: Number, default: 0 }
});

export const Counter = models.Counter ?? model("Counter", CounterSchema);
