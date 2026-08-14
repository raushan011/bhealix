import { Schema, model, models } from "mongoose";
import {
  COMMISSION_BASES, COMMISSION_STATUSES, CUSTOMER_DISCOUNT_TYPES, DEFAULT_BACKFILL_DAYS, DEFAULT_HOLD_DAYS,
  DELIVERY_STATES, ORDER_SOURCES, PAYOUT_MODES, PAYOUT_STATUSES
} from "@/lib/sales/constants";
import { DEFAULT_RULES } from "@/lib/sales/commission";
import { LEAD_SOURCES, LEAD_STATUSES } from "@/lib/sales/leads";
import { COUPON_SETUP_STATES, REP_STATUSES } from "@/lib/sales/partners";

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
  note: String,

  /**
   * Whether the code exists where a customer can actually type it.
   *
   * Holding a code here does not create it in Shopify, and for years that was
   * fine because a code only ever got here *after* somebody made it over there.
   * A rep minting their own reverses the order — the CRM now has codes Shopify
   * has never heard of — and a rep whose code is refused at the checkout while
   * their own portal shows it in green will conclude they are being cheated.
   *
   * Absent on every coupon written before self-service existed, and read as
   * `Live` by `couponSetupOf` for exactly that reason.
   */
  setup: { type: String, enum: COUPON_SETUP_STATES },
  /** Shopify's own id for the discount, so it can be found and withdrawn later. */
  shopifyDiscountId: String,
  /** Why Shopify refused, kept verbatim for whoever has to fix it. */
  setupError: String,
  /** Who asked for it. A rep's own codes are the ones worth watching. */
  issuedBy: { type: String, enum: ["Admin", "Rep"], default: "Admin" },
  issuedAt: Date
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

  // ------------------------------------------------------------- the account
  /*
   * There is deliberately **no link to a `User` here.**
   *
   * There used to be one — an optional reference kept against the day reps got
   * their own screens. That day came, and the answer turned out to be the
   * opposite: an affiliate is not a member of staff and must never be reachable
   * as one. The field was never read by anything, and leaving it would have
   * suggested a relationship the whole design refuses.
   *
   * The two are different populations with different words for them, and the
   * distinction is worth stating once because the vocabulary invites the
   * mistake. A **sales executive** is an employee of this company with the
   * `SALES` role: they carry an employee id, appear in the HR register, are paid
   * a salary through payroll, work the doctor round from `/employee`, and have
   * nothing to do with coupons. A **sales partner** is an outsider who sells
   * online with a discount code and takes a share of what arrives: no employee
   * id, no attendance, no payslip, their own portal at `/partner`, and paid by a
   * commission run rather than a payroll month.
   *
   * Somebody could of course be both, in the way an employee could also be a
   * customer. They would then have two records, because they are two
   * relationships with the company — and merging them would put an outsider in
   * the collection payroll iterates over.
   */
  /**
   * The affiliate's own password, and with it their own portal.
   *
   * Deliberately **not** a `User`. That collection is the staff register: it
   * requires an employee id, HR lists every row in it, and payroll runs over
   * it month by month. An affiliate given a `User` would appear in the
   * employee list, in the attendance screen and in the payroll month — a dozen
   * empty fields and, worse, a person the company does not employ sitting in
   * the place where salaries are calculated.
   *
   * So the credential lives on the record that already describes them. `select:
   * false`, like `User.passwordHash`, so the twenty screens that read a rep
   * cannot serialise a hash into their own HTML.
   */
  passwordHash: { type: String, select: false },

  /**
   * Where they stand with the company. See `lib/sales/partners.ts` for why this
   * is a separate question from `active`, and why an absent value means Active
   * rather than Pending.
   */
  status: { type: String, enum: REP_STATUSES, index: true },
  approvedBy: { type: Schema.Types.ObjectId, ref: "User" },
  approvedAt: Date,
  /** Why they were turned away or suspended — shown to them, so it is written to be read. */
  reviewNote: String,
  /** They registered themselves rather than being typed in. Worth knowing when reviewing one. */
  selfRegistered: { type: Boolean, default: false },
  lastLoginAt: Date,

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

/**
 * An email address identifies exactly one affiliate, because it is what they
 * sign in with.
 *
 * Sparse, so the reps who have never been given one — most of the people typed
 * in before the portal existed — do not all collide on nothing. Every write path
 * stores an absent address as `undefined` rather than `""` for the same reason:
 * a handful of empty strings would collide with each other.
 */
SalesRepSchema.index({ email: 1 }, { unique: true, sparse: true });

/** The approvals queue: who is waiting, oldest first. */
SalesRepSchema.index({ status: 1, createdAt: 1 });

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

// -------------------------------------------------------------- coupon catalogue

/**
 * Every discount code known to exist, whoever it belongs to.
 *
 * Deliberately **not** where a coupon's owner is recorded — that stays on
 * `SalesRep.coupons`, so there is one answer to "whose is this" rather than two
 * that can disagree. This is the catalogue: what Shopify has, and what has been
 * seen on an order. The two are joined at read time.
 *
 * It exists because a coupon is created in Shopify and then has to be typed in
 * here before an order using it can be attributed. A code in one place and not
 * the other is money going out with nobody credited, and the only way to notice
 * is to list both together.
 */
const SalesCouponSchema = new Schema({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
  /** What Shopify calls the discount this code belongs to. */
  title: String,
  /** ACTIVE, EXPIRED, SCHEDULED — Shopify's own word, or Unknown for a code only seen on an order. */
  status: { type: String, default: "Unknown", index: true },
  /** "₹800 off", "10% off". */
  summary: String,
  startsAt: Date,
  endsAt: Date,
  /** Shopify's own count of how many times it has been used. */
  usageCount: Number,

  /** Where we learned of it: the shop's discount list, or an order carrying it. */
  discoveredFrom: { type: String, enum: ["Shopify", "Order"], default: "Order" },
  firstSeenAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now },

  /**
   * Marked as belonging to nobody — a launch promo, a campaign. Keeps the sync
   * from naming it after every pass, which is how a warning becomes wallpaper.
   */
  ignored: { type: Boolean, default: false, index: true }
}, { timestamps: true });

export const SalesCoupon = models.SalesCoupon ?? model("SalesCoupon", SalesCouponSchema);

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

  /** How far back the order pull reached. "0 read" is only news when this is old. */
  ordersSince: Date,
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

// --------------------------------------------------------------------- leads

/**
 * A business somebody found and decided was worth approaching.
 *
 * The affiliate scheme grows one conversation at a time, and the conversations
 * start with a list: every beauty parlour in Ghaziabad, every gym in Noida.
 * Searching Google for that list is quick and it is billed; working through it
 * takes a fortnight. Keeping the results is what stops the same search — and
 * the same charge — happening again on Monday.
 *
 * Not a `SalesRep` and not a `Doctor`. A rep is somebody who already sells for
 * this company and holds a coupon; a lead is a shopfront that has never heard
 * of it. A doctor is visited on a planned route against a call window, which a
 * parlour has none of. Filing a lead as either would mean a record that is
 * mostly empty and a list that answers the wrong question.
 */
const SalesLeadSchema = new Schema({
  name: { type: String, required: true, trim: true, index: true },

  /**
   * What kind of business this is, chosen at the moment of searching.
   *
   * Free text rather than an enum, and required rather than optional: it is the
   * only thing that makes a saved lead findable again once the search that
   * produced it is forgotten. Spelled `type: { type: String }` because a bare
   * `String` on a key called `type` is read by mongoose as the field's own type
   * declaration (§11).
   */
  type: { type: String, required: true, trim: true, index: true },

  status: { type: String, enum: LEAD_STATUSES, default: "New", index: true },

  /**
   * When somebody last opened WhatsApp against this lead, and how many times.
   *
   * Separate from `status` because they answer different questions. The status
   * is what the parlour *said*; this is what we did, and the gap between them is
   * the whole point — a lead messaged three times and still sitting at `New` is
   * either a bad number or a decision somebody needs to take.
   *
   * The count is deliberately not a cap. Nothing here stops a fourth message;
   * the queue simply puts the least-recently-messaged first, so a working list
   * empties before it repeats.
   */
  lastContactedAt: { type: Date, index: true },
  contactCount: { type: Number, default: 0, min: 0 },

  phone: { type: String, trim: true },
  website: { type: String, trim: true },
  address: { type: String, trim: true },
  area: { type: String, trim: true },
  city: { type: String, trim: true, index: true },

  /**
   * Google's identity for the place, and the reason a second sweep of the same
   * area updates the twenty rows already held instead of duplicating them.
   * Sparse, because a lead typed in by hand has no Google identity to match on.
   */
  googlePlaceId: { type: String, unique: true, sparse: true, index: true },
  googleMapsUrl: String,
  rating: Number,
  reviewCount: Number,
  /**
   * Plain numbers rather than a GeoJSON point. Nothing routes a lead, so the
   * 2dsphere index — and the half-a-point save failure that comes with it
   * (§6.2) — would be a trap kept for no gain.
   */
  latitude: Number,
  longitude: Number,

  /**
   * The search that found it, kept verbatim. Six months on, "why is a nail bar
   * filed under Beauty parlour" is answered by the words somebody actually
   * typed, and not by anybody's memory of them.
   */
  searchQuery: String,
  searchLocation: String,
  source: { type: String, enum: LEAD_SOURCES, default: "Google" },

  notes: String,
  createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  updatedBy: { type: Schema.Types.ObjectId, ref: "User" }
}, { timestamps: true });

// The two questions the list screen asks: this trade, alphabetically, and
// whatever still needs ringing, newest first.
SalesLeadSchema.index({ type: 1, name: 1 });
SalesLeadSchema.index({ status: 1, createdAt: -1 });

export const SalesLead = models.SalesLead ?? model("SalesLead", SalesLeadSchema);

// ----------------------------------------------------------------- outreach

/**
 * What gets said to a lead, written once.
 *
 * A collection rather than an array on the settings document next door, because
 * these are written and rewritten by whoever is doing the prospecting that
 * month — a Diwali message, a follow-up for the ones who went quiet, one for
 * salons and a blunter one for chemists. Settings is for commercial decisions
 * taken once; this is working material, and it wants its own timestamps and its
 * own delete.
 *
 * The body is stored with its `{{name}}` placeholders intact. Rendering happens
 * at the moment of sending (`lib/sales/outreach.ts`), so correcting a typo here
 * fixes every message not yet sent rather than only the next batch.
 */
const SalesTemplateSchema = new Schema({
  name: { type: String, required: true, trim: true },
  body: { type: String, required: true, trim: true },
  /** Free text, mirroring the lead's own type — "Beauty parlour", "Chemist". */
  audience: { type: String, trim: true },
  createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  updatedBy: { type: Schema.Types.ObjectId, ref: "User" }
}, { timestamps: true });

/** The one question the picker asks: what have we got, most recent first. */
SalesTemplateSchema.index({ updatedAt: -1 });

export const SalesTemplate = models.SalesTemplate ?? model("SalesTemplate", SalesTemplateSchema);

// ------------------------------------------------------------------ settings

const RuleSchema = new Schema({
  suffix: { type: String, required: true, trim: true },
  label: { type: String, required: true, trim: true },
  rate: { type: Number, required: true, min: 0, max: 100 },
  base: { type: String, enum: COMMISSION_BASES, default: "Discounted lines" },
  products: { type: [String], default: [] },
  active: { type: Boolean, default: true },

  /**
   * What the **customer** gets off, which is not what the rep earns.
   *
   * `rate` above is the commission — the share of the sale that goes to the
   * person who brought it in. This is the discount the coupon actually applies
   * at the checkout, and the two are routinely different: a code can take ₹200
   * off for the buyer while paying the rep 30% of the line.
   *
   * It exists here because a rep minting their own code means the CRM now
   * creates discounts in Shopify rather than only reading them, and it cannot
   * invent what the discount should be. Left at zero, nothing is created: the
   * code is reserved and flagged `Awaiting setup` rather than a guess being
   * pushed at the shop.
   */
  customerDiscountType: { type: String, enum: CUSTOMER_DISCOUNT_TYPES, default: "Percentage" },
  customerDiscountValue: { type: Number, min: 0, default: 0 },
  /** Whether one customer may use a code more than once. Off is the usual answer for a referral code. */
  oncePerCustomer: { type: Boolean, default: true }
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
