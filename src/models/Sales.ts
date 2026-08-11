import { Schema, model, models } from "mongoose";
import {
  COMMISSION_BASES, COMMISSION_STATUSES, DEFAULT_BACKFILL_DAYS, DEFAULT_HOLD_DAYS,
  DELIVERY_STATES, ORDER_SOURCES, PAYOUT_MODES, PAYOUT_STATUSES
} from "@/lib/sales/constants";
import { DEFAULT_RULES } from "@/lib/sales/commission";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The affiliate side of the business: the people who sell on commission, the
 * orders their coupons brought in, and the runs that pay them.
 *
 * Deliberately a separate world from `User` and `Invoice`. A sales affiliate is
 * not an employee — there is no attendance, no payslip and no salary structure
 * behind them — and an order placed on Shopify is not a GST invoice this company
 * raised. Modelling them as either would have meant a dozen fields that are
 * always empty and a permission table that no longer says what it means.
 */

// ---------------------------------------------------------------------- reps

const CouponSchema = new Schema({
  /** Upper-cased on the way in; every comparison in the sync is against this. */
  code: { type: String, required: true, uppercase: true, trim: true },
  /** The digits at the end — which commission rule this code carries. */
  suffix: { type: String, required: true, trim: true },
  active: { type: Boolean, default: true },
  note: String
}, { _id: false });

const SalesRepSchema = new Schema({
  /** The name half of every coupon they hold: "RAUSHAN". */
  code: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
  name: { type: String, required: true, trim: true, index: true },
  phone: String,
  email: { type: String, lowercase: true, trim: true },

  /**
   * Every code that attributes an order to this person. A list rather than two
   * columns: a rep given a third code for a campaign should not need a schema
   * change, and a code withdrawn must stay on the record so the orders it
   * already brought in still have somewhere to point.
   */
  coupons: { type: [CouponSchema], default: [] },

  /**
   * Optional link to a login. Nothing uses it yet — the panel is the
   * administrator's — but attributing a payout to an account is the one thing
   * that would otherwise need backfilling the day reps get their own screens.
   */
  user: { type: Schema.Types.ObjectId, ref: "User" },

  /** Where the money goes. Copied onto a payout line when a run is generated. */
  payMethod: { type: String, enum: PAYOUT_MODES, default: "UPI" },
  upiId: String,
  bankName: String,
  bankAccountName: String,
  bankAccountNo: String,
  bankIfsc: String,
  panNumber: String,

  active: { type: Boolean, default: true, index: true },
  joinedAt: Date,
  notes: String,
  createdBy: { type: Schema.Types.ObjectId, ref: "User" }
}, { timestamps: true });

/**
 * No two reps may hold the same coupon code. Unique across the multikey array,
 * so the constraint is the database's rather than a check somebody can forget:
 * two reps sharing a code would make every order it brought in unattributable,
 * and there is no way to work out afterwards whose it was.
 */
SalesRepSchema.index({ "coupons.code": 1 }, { unique: true, sparse: true });

export const SalesRep = models.SalesRep ?? model("SalesRep", SalesRepSchema);

// -------------------------------------------------------------------- orders

/**
 * One line as it was sold. Every figure is the rupee amount for the whole line,
 * not the unit — that is how Shopify reports discounts, and converting back and
 * forth is how a rounding error gets into somebody's commission.
 */
const OrderItemSchema = new Schema({
  productId: String,
  variantId: String,
  sku: String,
  title: { type: String, required: true },
  quantity: { type: Number, default: 1 },
  /** Charged for the line before anything came off it. */
  gross: { type: Number, default: 0 },
  /** What the rep's own coupon took off this line. */
  couponDiscount: { type: Number, default: 0 },
  /** A site-wide offer stacked on top of it. */
  otherDiscount: { type: Number, default: 0 },
  refunded: { type: Number, default: 0 }
}, { _id: false });

const SalesOrderSchema = new Schema({
  source: { type: String, enum: ORDER_SOURCES, default: "Shopify", index: true },
  /** Shopify's own id. Unique and sparse, so the sync upserts rather than duplicates. */
  shopifyOrderId: { type: String, unique: true, sparse: true, index: true },
  /** What the customer and the courier both call it: "#1042". */
  name: { type: String, index: true },
  orderNumber: Number,
  placedAt: { type: Date, required: true, index: true },
  currency: { type: String, default: "INR" },

  customer: {
    name: String,
    email: String,
    phone: String,
    city: String,
    state: String,
    pinCode: String
  },

  /** The coupon that attributed it, and the rep behind that coupon. */
  couponCode: { type: String, uppercase: true, index: true },
  rep: { type: Schema.Types.ObjectId, ref: "SalesRep", index: true },
  /** Which rule applied, by suffix. Stored so a renamed rule cannot restate an old order. */
  ruleSuffix: String,
  /** Every code on the order, including offers that belong to nobody. */
  discountCodes: { type: [String], default: [] },

  items: { type: [OrderItemSchema], default: [] },
  totals: {
    gross: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    refunded: { type: Number, default: 0 },
    /** What the customer actually paid, after discounts and refunds. */
    paid: { type: Number, default: 0 }
  },

  financialStatus: String,
  paymentMethod: String,
  cancelledAt: Date,
  fullyRefunded: { type: Boolean, default: false },

  /** What Shiprocket says, kept raw beside what we made of it. */
  shipment: {
    shiprocketOrderId: String,
    shipmentId: String,
    awb: String,
    courier: String,
    /** Shiprocket's own wording, stored verbatim so an unrecognised one can be read later. */
    status: String,
    statusCode: Number,
    deliveredAt: Date,
    checkedAt: Date
  },

  delivery: {
    /** What the courier's status mapped to. */
    reported: { type: String, enum: DELIVERY_STATES, default: "Awaiting" },
    /**
     * What somebody decided by hand, when the courier's answer was wrong or
     * unreadable — a partial delivery settled with the customer, a status
     * Shiprocket has not taught us yet. Set, it wins.
     */
    override: { type: String, enum: DELIVERY_STATES },
    overrideReason: String,
    overrideBy: { type: Schema.Types.ObjectId, ref: "User" },
    overrideAt: Date,
    /** The effective state: the override if there is one, otherwise the report. Cached — see §4.4. */
    state: { type: String, enum: DELIVERY_STATES, default: "Awaiting", index: true },
    at: Date
  },

  /**
   * What the order is worth to the rep. A cache of the arithmetic in
   * `lib/sales/commission.ts`, maintained by `recalculateCommission` alone, so
   * a hundred orders can be listed and totalled without recomputing each one.
   */
  commission: {
    rate: { type: Number, default: 0 },
    /** The money the rate was applied to. */
    base: { type: Number, default: 0 },
    amount: { type: Number, default: 0 },
    status: { type: String, enum: COMMISSION_STATUSES, default: "Pending", index: true },
    maturesAt: { type: Date, index: true },
    /** No line carried an allocation from the coupon, so the whole order was used. */
    wholeOrderFallback: { type: Boolean, default: false },
    /** Why nothing is owed, in a sentence fit for the screen. */
    reason: String,
    /**
     * Promised, then the parcel came back. Nothing is reversed automatically —
     * this is a flag for somebody to act on, because money already sent is
     * recovered by agreement and not by a job editing an approved run.
     */
    needsReversal: { type: Boolean, default: false },
    payout: { type: Schema.Types.ObjectId, ref: "SalesPayout", index: true },
    computedAt: Date
  },

  syncedAt: Date,
  notes: String
}, { timestamps: true });

// The two questions every screen asks: this rep's orders newest first, and
// what is payable right now.
SalesOrderSchema.index({ rep: 1, placedAt: -1 });
SalesOrderSchema.index({ "commission.status": 1, "commission.maturesAt": 1 });
SalesOrderSchema.index({ "delivery.state": 1, placedAt: -1 });

export const SalesOrder = models.SalesOrder ?? model("SalesOrder", SalesOrderSchema);

// ------------------------------------------------------------------- payouts

/**
 * One week's payout for every rep at once.
 *
 * The same shape and the same state machine as a payroll run, for the same
 * reasons: a period is settled once, as a unit; a draft may be regenerated
 * while orders are still being delivered; and preparing a payment is a
 * different authority from releasing it. Paid is terminal — the money has left.
 */
const SalesPayoutSchema = new Schema({
  payoutNo: { type: String, required: true, unique: true, index: true },
  financialYear: { type: String, required: true, index: true },
  from: { type: String, required: true, match: ISO_DATE },
  to: { type: String, required: true, match: ISO_DATE, index: true },
  status: { type: String, enum: PAYOUT_STATUSES, default: "Draft", index: true },

  /** Frozen onto the run, so changing the policy cannot restate a past week. */
  holdDays: { type: Number, default: DEFAULT_HOLD_DAYS },

  totals: {
    reps: { type: Number, default: 0 },
    orders: { type: Number, default: 0 },
    gross: { type: Number, default: 0 },
    net: { type: Number, default: 0 }
  },

  generatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  generatedAt: Date,
  approvedBy: { type: Schema.Types.ObjectId, ref: "User" },
  approvedAt: Date,
  paidBy: { type: Schema.Types.ObjectId, ref: "User" },
  paidAt: Date,
  paymentDate: String,
  paymentMode: { type: String, enum: PAYOUT_MODES },
  reference: String,
  note: String
}, { timestamps: true });

export const SalesPayout = models.SalesPayout ?? model("SalesPayout", SalesPayoutSchema);

const AdjustmentSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  /** Signed. A recovery is a negative line with a reason on it, never a quietly smaller total. */
  amount: { type: Number, required: true, default: 0 }
}, { _id: false });

/**
 * The orders carried, copied onto the line rather than joined at read time.
 *
 * A payout advice is evidence (§4.5). A rep asking in November what the ₹1,800
 * paid in August was made of is owed the four orders and the figure each one
 * earned, exactly as they stood — not a fresh query that a later refund or a
 * changed rate would answer differently.
 */
const PaidOrderSchema = new Schema({
  order: { type: Schema.Types.ObjectId, ref: "SalesOrder", required: true },
  name: String,
  placedAt: Date,
  deliveredAt: Date,
  base: { type: Number, default: 0 },
  rate: { type: Number, default: 0 },
  amount: { type: Number, default: 0 }
}, { _id: false });

const SalesPayoutLineSchema = new Schema({
  run: { type: Schema.Types.ObjectId, ref: "SalesPayout", required: true, index: true },
  rep: { type: Schema.Types.ObjectId, ref: "SalesRep", required: true, index: true },

  /** Who they were and where the money went, as it stood on the day. */
  snapshot: {
    name: String,
    code: String,
    phone: String,
    payMethod: { type: String, enum: PAYOUT_MODES },
    upiId: String,
    bankName: String,
    /** Only the last four are ever shown on an advice, so only those are kept. */
    bankAccountLastFour: String,
    panNumber: String
  },

  orders: { type: [PaidOrderSchema], default: [] },
  orderCount: { type: Number, default: 0 },
  gross: { type: Number, default: 0 },
  adjustments: { type: [AdjustmentSchema], default: [] },
  net: { type: Number, default: 0 },
  note: String
}, { timestamps: true });

// One line per rep per run, whatever route created it.
SalesPayoutLineSchema.index({ run: 1, rep: 1 }, { unique: true });
SalesPayoutLineSchema.index({ rep: 1, createdAt: -1 });

export const SalesPayoutLine = models.SalesPayoutLine ?? model("SalesPayoutLine", SalesPayoutLineSchema);

// ---------------------------------------------------------------- sync history

/**
 * What each pull did, kept so the automation can be seen working.
 *
 * Without this, "it syncs every night" is a claim rather than a fact, and the
 * first anybody learns that it stopped is a payout run that comes back empty.
 * A row per pass, with the same figures the operator sees when they press the
 * button by hand.
 *
 * The TTL is what keeps it from growing without limit: MongoDB removes a row
 * 90 days after it is written, with no job to schedule and nothing to remember.
 */
const SalesSyncRunSchema = new Schema({
  trigger: { type: String, enum: ["Manual", "Scheduled", "Webhook"], default: "Manual", index: true },
  target: String,
  finishedAt: { type: Date, default: Date.now, index: true },
  durationMs: Number,

  ordersSeen: { type: Number, default: 0 },
  ordersAttributed: { type: Number, default: 0 },
  ordersCreated: { type: Number, default: 0 },
  ordersUpdated: { type: Number, default: 0 },
  shipmentsMatched: { type: Number, default: 0 },
  commissionsRecalculated: { type: Number, default: 0 },

  unknownCoupons: { type: [String], default: [] },
  warnings: { type: [String], default: [] },
  /** Set when the pass failed outright; the figures above are then what it managed first. */
  error: String,

  actor: { type: Schema.Types.ObjectId, ref: "User" },
  /** Removed automatically 90 days on — see the note above. */
  expiresAt: { type: Date, required: true }
}, { timestamps: true });

SalesSyncRunSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const SalesSyncRun = models.SalesSyncRun ?? model("SalesSyncRun", SalesSyncRunSchema);

// ------------------------------------------------------------------ settings

const RuleSchema = new Schema({
  suffix: { type: String, required: true, trim: true },
  label: { type: String, required: true, trim: true },
  rate: { type: Number, required: true, min: 0, max: 100 },
  base: { type: String, enum: COMMISSION_BASES, default: "Discounted lines" },
  products: { type: [String], default: [] },
  active: { type: Boolean, default: true }
}, { _id: false });

/**
 * How this company runs its affiliate scheme. One document, like the billing and
 * payroll settings next door, because a commission rate and a hold period are
 * commercial decisions taken at a desk, not in a deployment.
 */
const SalesSettingsSchema = new Schema({
  key: { type: String, default: "sales", unique: true, index: true },

  /**
   * The credentials. Both are encrypted at rest (`lib/sales/secrets.ts`) and
   * `select: false` besides, so the settings screen, the dashboard and every
   * sync that only wants a rate never drags them into memory. Exactly one
   * helper asks for them with `+`.
   */
  shopifyDomain: String,
  /**
   * The app's own credentials, for the OAuth handshake.
   *
   * Shopify stopped issuing new legacy custom apps on 1 January 2026, and with
   * them the `shpat_` token that could simply be pasted in. A Dev Dashboard app
   * gives a client id and secret instead, and the token is earned by sending
   * the merchant through an approval screen (`lib/sales/oauth.ts`).
   */
  shopifyClientId: String,
  shopifyClientSecret: { type: String, select: false },
  /** Whichever way it was obtained — the handshake, or pasted from a legacy app. */
  shopifyAccessToken: { type: String, select: false },
  /** What Shopify actually granted, which is not always what was asked for. */
  shopifyScopes: String,
  shopifyApiVersion: { type: String, default: "2026-07" },
  shopifyConnectedAt: Date,
  lastOrderSyncAt: Date,
  lastOrderSyncError: String,

  shiprocketEmail: String,
  shiprocketPassword: { type: String, select: false },
  /** Shiprocket's bearer token lasts ten days; caching it saves a login per sync. */
  shiprocketToken: { type: String, select: false },
  shiprocketTokenExpiresAt: Date,
  lastShipmentSyncAt: Date,
  lastShipmentSyncError: String,

  rules: { type: [RuleSchema], default: () => DEFAULT_RULES },
  /** Days a delivered order is held before its commission may be paid. */
  holdDays: { type: Number, min: 0, max: 90, default: DEFAULT_HOLD_DAYS },
  /** The day of the week payouts are ordinarily made, for the dashboard to propose. */
  payoutWeekday: { type: Number, min: 0, max: 6, default: 1 },
  /** How far back a first sync reaches when nothing has ever been pulled. */
  backfillDays: { type: Number, min: 1, max: 730, default: DEFAULT_BACKFILL_DAYS },
  currency: { type: String, default: "INR" }
}, { timestamps: true });

export const SalesSettings = models.SalesSettings ?? model("SalesSettings", SalesSettingsSchema);
