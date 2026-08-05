import { Schema, model, models } from "mongoose";
import { DISCOUNT_TYPES, INVOICE_STATUSES, PARTY_SOURCES, PAYMENT_MODES } from "@/lib/billing/constants";

/**
 * A line as it was billed, not as the catalogue reads today. Every figure the
 * invoice printed is stored: a reprint two years from now has to show what the
 * doctor was actually charged, whatever has happened to prices since.
 */
const ItemSchema = new Schema({
  product: { type: Schema.Types.ObjectId, ref: "Product" },
  name: { type: String, required: true },
  hsnCode: String,
  unit: String,
  quantity: { type: Number, required: true, min: 0 },
  rate: { type: Number, required: true, min: 0 },
  discountType: { type: String, enum: DISCOUNT_TYPES, default: "PERCENT" },
  discountValue: { type: Number, default: 0, min: 0 },
  gstRate: { type: Number, default: 0, min: 0 },

  // Computed on the server by lib/billing/gst.ts — never taken from the client.
  gross: { type: Number, default: 0 },
  discount: { type: Number, default: 0 },
  taxableValue: { type: Number, default: 0 },
  cgst: { type: Number, default: 0 },
  sgst: { type: Number, default: 0 },
  igst: { type: Number, default: 0 },
  taxAmount: { type: Number, default: 0 },
  total: { type: Number, default: 0 }
}, { _id: false });

/**
 * One receipt against the invoice. An invoice is settled in as many parts as the
 * doctor pays in, and the balance is always the total less the sum of these —
 * so deleting a receipt entered by mistake corrects the invoice by itself.
 */
const PaymentSchema = new Schema({
  amount: { type: Number, required: true, min: 0.01 },
  mode: { type: String, enum: PAYMENT_MODES, required: true },
  reference: String,
  paidAt: { type: Date, required: true, default: Date.now },
  /** Who took the money — usually the representative standing in the clinic. */
  receivedBy: { type: Schema.Types.ObjectId, ref: "User" },
  recordedBy: { type: Schema.Types.ObjectId, ref: "User" },
  notes: String
}, { timestamps: true });

const TaxSummarySchema = new Schema({
  hsnCode: String,
  gstRate: Number,
  taxableValue: Number,
  cgst: Number,
  sgst: Number,
  igst: Number
}, { _id: false });

const InvoiceSchema = new Schema({
  invoiceNo: { type: String, required: true, unique: true, index: true },
  financialYear: { type: String, required: true, index: true },
  /** true prints a Tax Invoice with GST; false prints a Bill of Supply with none. */
  taxed: { type: Boolean, default: true },

  /**
   * The buyer, held as a reference to whichever directory they came from, and
   * as a snapshot in `billTo` either way.
   *
   * At most one of these is set. A one-off sale — a walk-in individual who is
   * never going to be billed twice — sets neither and lives entirely in the
   * snapshot, so the directories stay a list of people worth keeping.
   */
  doctor: { type: Schema.Types.ObjectId, ref: "Doctor", index: true },
  customer: { type: Schema.Types.ObjectId, ref: "Customer", index: true },
  /** How the buyer was chosen: Doctor, Customer or One-off. */
  partySource: { type: String, enum: PARTY_SOURCES, default: "Doctor", index: true },
  /** What kind of buyer they are — "Doctor", "Stockist", "Individual" and so on. */
  partyType: { type: String, default: "Doctor", index: true },
  /**
   * Whose bill this is. Every invoice belongs to a representative — it is how
   * collection is chased, how a follow-up lands on the right phone, and how the
   * rep sees what is still owed on their own round.
   */
  employee: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },

  // Copied at the time of billing: the doctor's address may change afterwards,
  // the invoice's may not.
  billTo: {
    name: String, clinicName: String, address: String,
    city: String, state: String, stateCode: String,
    pinCode: String, gstin: String, phone: String,
    /** Printed under the name, so the bill says who it was raised for. */
    type: String
  },
  placeOfSupply: { state: String, code: String },
  /** Place of supply outside the seller's state, so IGST replaces CGST + SGST. */
  interState: { type: Boolean, default: false },
  ratesIncludeTax: { type: Boolean, default: false },

  items: { type: [ItemSchema], default: [] },
  taxSummary: { type: [TaxSummarySchema], default: [] },

  subtotal: { type: Number, default: 0 },
  totalDiscount: { type: Number, default: 0 },
  taxableValue: { type: Number, default: 0 },
  cgstTotal: { type: Number, default: 0 },
  sgstTotal: { type: Number, default: 0 },
  igstTotal: { type: Number, default: 0 },
  taxTotal: { type: Number, default: 0 },
  roundOff: { type: Number, default: 0 },
  grandTotal: { type: Number, default: 0 },

  payments: { type: [PaymentSchema], default: [] },
  // Kept in step with `payments` by recalculate() in lib/billing/invoices.ts, so
  // a list of a hundred invoices does not have to add up every receipt to sort
  // by what is owed.
  amountPaid: { type: Number, default: 0 },
  balanceDue: { type: Number, default: 0 },
  status: { type: String, enum: INVOICE_STATUSES, default: "Unpaid", index: true },

  invoiceDate: { type: Date, required: true, index: true },
  /** When the money is due. */
  dueDate: { type: Date, index: true },
  paymentTerms: { type: Number, default: 0 },
  /** When the rep should call about it — often earlier than the due date. */
  followUpDate: { type: Date, index: true },

  notes: String,
  terms: String,

  createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  cancelledAt: Date,
  cancelledBy: { type: Schema.Types.ObjectId, ref: "User" },
  cancelReason: String
}, { timestamps: true });

InvoiceSchema.index({ employee: 1, invoiceDate: -1 });
InvoiceSchema.index({ doctor: 1, invoiceDate: -1 });
InvoiceSchema.index({ status: 1, dueDate: 1 });

export const Invoice = models.Invoice ?? model("Invoice", InvoiceSchema);
