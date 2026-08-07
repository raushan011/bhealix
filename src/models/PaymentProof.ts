import { Schema, model, models } from "mongoose";
import { PROOF_TYPES } from "@/lib/billing/attachments";

/**
 * The file somebody attached to a receipt: the UPI screenshot, the photograph of
 * a cheque, the bank advice.
 *
 * Held apart from the invoice for the same reason a visit's photographs are held
 * apart from the visit — the bytes would otherwise be read by every screen that
 * touches a bill, none of which want them. What those screens do want (that a
 * proof exists, its size, who attached it and when) is copied onto the payment
 * itself, so the list renders without a second query.
 *
 * Unlike a visit photo this one never expires. It is the answer to "the doctor
 * says they paid in March" years after March, and a receipt without its evidence
 * is the thing an audit asks about.
 */
const PaymentProofSchema = new Schema({
  invoice: { type: Schema.Types.ObjectId, ref: "Invoice", required: true, index: true },
  /** The `_id` of the payment subdocument on that invoice. One file per receipt. */
  payment: { type: Schema.Types.ObjectId, required: true, unique: true, index: true },

  data: { type: Buffer, required: true, select: false },
  contentType: { type: String, enum: PROOF_TYPES, required: true },
  bytes: { type: Number, required: true },
  fileName: { type: String, maxlength: 200 },

  uploadedBy: { type: Schema.Types.ObjectId, ref: "User", required: true }
}, { timestamps: true });

export const PaymentProof = models.PaymentProof ?? model("PaymentProof", PaymentProofSchema);
