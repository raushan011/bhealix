import { Schema, model, models } from "mongoose";
import { SOURCE_KEYS } from "@/lib/finance/sources";
import { VAULT_FILE_TYPES } from "@/lib/finance/files";

/**
 * The vendor invoice vault: every bill this company was *sent*, filed by the
 * month it belongs to.
 *
 * The opposite direction from `models/Invoice`, which is what the company bills
 * doctors. Nothing joins the two and nothing should: one is revenue and the
 * other is the purchase paper the input credit sits on, and the only screen that
 * wants both at once is the accountant's own, in a different application.
 *
 * The bytes live on the document rather than in a collection of their own —
 * unlike a payment proof, which was split out because every screen that touches
 * a bill would otherwise drag the image with it. Here the file *is* the record;
 * there is no other reader. `select: false` keeps the list queries light, which
 * is the whole of what the split would have bought.
 */
const VendorInvoiceSchema = new Schema({
  /**
   * The accounting month, as `"2026-08"`.
   *
   * Filed against explicitly rather than derived from `documentDate`, because
   * the two genuinely differ and the difference is the accountant's to decide:
   * a Meta receipt dated the 2nd of September is usually August's advertising,
   * and a wallet recharge made in March against April's freight is argued about
   * every year. The date is kept as well, so a wrong month can be spotted.
   */
  period: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/, index: true },
  source: { type: String, enum: SOURCE_KEYS, required: true, index: true },

  /** What the vendor calls it. Free text — every one of them numbers differently. */
  number: { type: String, trim: true, maxlength: 120 },
  /** The date printed on the document, which is not always in `period`. */
  documentDate: Date,
  description: { type: String, trim: true, maxlength: 300 },

  /**
   * What it came to, in paise-free rupees.
   *
   * Optional throughout. A month's worth of Shiprocket order invoices is pulled
   * as one merged PDF with no single figure on it, and an offline bill is
   * frequently filed before anybody has read the total off it — refusing the
   * upload until a number is typed would mean the file does not get filed at
   * all, which is the failure this whole screen exists to prevent.
   */
  amount: { type: Number, min: 0 },
  /** The tax on it, where it is broken out. What the input credit is claimed on. */
  taxAmount: { type: Number, min: 0 },
  currency: { type: String, default: "INR" },

  data: { type: Buffer, required: true, select: false },
  contentType: { type: String, enum: VAULT_FILE_TYPES, required: true },
  bytes: { type: Number, required: true },
  fileName: { type: String, required: true, maxlength: 200 },

  /**
   * How it got here: fetched by the sync, or put there by a person.
   *
   * Worth recording because it changes what a missing month means. A source that
   * is pulled and has nothing filed is a sync that failed or has not run; a
   * source that is uploaded and has nothing filed is a job somebody has not done
   * yet, and the screen says so differently.
   */
  origin: { type: String, enum: ["pulled", "uploaded"], required: true },
  /**
   * The vendor's own identifier for what was fetched, so a second sync updates
   * rather than duplicates. Sparse: an uploaded file has no such thing.
   */
  externalRef: { type: String, index: true, sparse: true },

  uploadedBy: { type: Schema.Types.ObjectId, ref: "User" },
  notes: { type: String, trim: true, maxlength: 500 }
}, { timestamps: true });

/**
 * The one query this collection is actually asked: a month, sometimes narrowed
 * to a vendor, newest first. The sort is in the index so the list and the
 * archive both come back ordered without a fetch-and-sort in memory.
 */
VendorInvoiceSchema.index({ period: -1, source: 1, documentDate: -1 });

/**
 * What the sync upserts against.
 *
 * Partial rather than sparse, and the distinction matters: a sparse unique index
 * would still collide on the *absence* of the field in some driver versions,
 * whereas this one simply does not see uploaded documents at all. Two pulls of
 * the same Shiprocket month therefore leave one row, and forty hand-filed
 * receipts with no external reference are none of its business.
 */
VendorInvoiceSchema.index(
  { source: 1, externalRef: 1 },
  { unique: true, partialFilterExpression: { externalRef: { $type: "string" } } }
);

export const VendorInvoice = models.VendorInvoice ?? model("VendorInvoice", VendorInvoiceSchema);

/**
 * A month's own state, apart from the documents in it.
 *
 * One document per month, created the first time anybody says anything about
 * that month. It exists for a single question the files cannot answer: has this
 * been sent to the accountant yet? A month that is complete and a month that has
 * been handed over are different things, and the second is the one somebody
 * needs to know on the fifteenth when the CA rings.
 */
const FinancePeriodSchema = new Schema({
  period: { type: String, required: true, unique: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
  /** When the bundle was sent, and by whom. Cleared if it has to be sent again. */
  handedOverAt: Date,
  handedOverBy: { type: Schema.Types.ObjectId, ref: "User" },
  /** "Meta invoice still missing — chasing", and anything else the next person needs. */
  note: { type: String, trim: true, maxlength: 1000 }
}, { timestamps: true });

export const FinancePeriod = models.FinancePeriod ?? model("FinancePeriod", FinancePeriodSchema);
