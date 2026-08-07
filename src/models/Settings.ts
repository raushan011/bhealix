import { Schema, model, models } from "mongoose";
import { DEFAULT_INVOICE_PREFIX } from "@/lib/billing/numbering";
import { QR_TYPES } from "@/lib/billing/attachments";

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
  bankBranch: String,
  upiId: String,

  /**
   * The payment QR, held as bytes in this document rather than as a file.
   *
   * There is one of them, it changes about once a year, and it has to appear on
   * a printed bill — a bucket to configure and a second set of credentials to
   * keep would all be spent on a picture the size of an email signature.
   *
   * `select: false` on the bytes: every billing screen and every print reads
   * these settings for the address and the GSTIN, and none of them want the
   * image dragged along. Only the one route that serves it asks for `+paymentQr`.
   * The three fields beside it are ordinary, so anything reading the settings
   * can still tell that a QR exists and when it was last replaced.
   */
  paymentQr: { type: Buffer, select: false },
  paymentQrType: { type: String, enum: QR_TYPES },
  paymentQrBytes: Number,
  paymentQrUpdatedAt: Date,
  /** Printed under the code — "Scan with any UPI app", or the payee's name. */
  paymentQrLabel: String,

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
