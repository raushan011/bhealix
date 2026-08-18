import { Schema, model, models } from "mongoose";
import {
  COMMISSION_BASES, COMMISSION_STATUSES, COURIER_RULES, CUSTOMER_DISCOUNT_TYPES, DEFAULT_BACKFILL_DAYS,
  DELIVERY_STATES, ORDER_SOURCES, PAYOUT_MODES
} from "@/lib/sales/constants";
import { DEFAULT_RULES } from "@/lib/sales/commission";
import { LEAD_SOURCES, LEAD_STATUSES, REMARK_CHANNELS } from "@/lib/sales/leads";
import { COUPON_SETUP_STATES, REP_STATUSES } from "@/lib/sales/partners";
import { FULFILMENT_STATES, RETARGET_STATUSES } from "@/lib/sales/retarget";

/**
 * The affiliate side of the business: the people who sell on commission, the
 * orders their coupons brought in, and what each order paid them.
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
   * id, no attendance, no payslip, their own portal at `/partner`, and paid a
   * commission per delivered order rather than a salary per month.
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

  /** Where the money goes — shown beside every Pay button, so nobody has to look it up. */
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

  /**
   * Where the parcel is going.
   *
   * The street lines exist because orders are booked with the courier from here
   * rather than in Shiprocket's own panel, and a booking without an address is
   * refused. They are filled in by the Shopify sync where the checkout collected
   * them, and typed in by whoever is processing the order where it did not — an
   * order imported from the Fastrr checkout export routinely arrives with a city
   * and a phone and no street at all, and nothing can invent one.
   */
  customer: {
    name: String,
    email: String,
    phone: String,
    address1: String,
    address2: String,
    city: String,
    state: String,
    pinCode: String,
    country: String
  },

  /** The coupon that attributed it, and the partner behind that coupon. */
  couponCode: { type: String, uppercase: true, index: true },
  rep: { type: Schema.Types.ObjectId, ref: "SalesRep", index: true },
  /**
   * Who that partner was, written on at the moment their record is deleted.
   *
   * Empty for every live order, because `rep` answers the question better — a
   * renamed partner should follow the reference rather than leave a stale copy
   * behind. It is filled in only on the way out.
   *
   * A deleted partner would otherwise leave this order pointing at nothing, and
   * a year of revenue would read as having been brought in by nobody — and a
   * commission already paid would no longer say who it was paid to.
   */
  repSnapshot: {
    name: String,
    code: String,
    /** So the row can say the record is gone rather than implying it is still there. */
    deletedAt: Date
  },
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

  /**
   * What Shiprocket says, kept raw beside what we made of it — and, since the
   * parcel is now booked from here, what we asked it for.
   *
   * The two halves are worth telling apart. Everything down to `checkedAt` is
   * read back by the delivery sync and may change on any pass; everything below
   * it is what somebody at this desk decided when they processed the order, and
   * is only ever written once.
   */
  shipment: {
    shiprocketOrderId: String,
    shipmentId: String,
    awb: String,
    courier: String,
    /** Shiprocket's own wording, stored verbatim so an unrecognised one can be read later. */
    status: String,
    statusCode: Number,
    deliveredAt: Date,
    checkedAt: Date,

    /** Which of the company's addresses the parcel leaves from, by Shiprocket's nickname for it. */
    pickupLocation: String,
    /** Shiprocket's id for the courier chosen, so the same one can be asked for again. */
    courierId: Number,
    /** What the parcel was declared as. Kept because it is what the freight was priced on. */
    parcel: {
      weight: Number,
      length: Number,
      breadth: Number,
      height: Number
    },
    /** What the courier was told to collect at the door — nothing, on a prepaid order. */
    codAmount: Number,
    /** Set only when a pickup was actually asked for; most warehouses have a standing one. */
    pickupScheduledAt: Date,
    pickupToken: String,

    /** When this order was booked from this screen, and by whom. */
    processedAt: Date,
    processedBy: { type: Schema.Types.ObjectId, ref: "User" },
    /**
     * Why the last attempt failed, in Shiprocket's own words.
     *
     * Kept on the order rather than only returned to the browser because a batch
     * of forty is read afterwards, not watched: the six that would not book have
     * to still say why when somebody comes back to them after lunch. Cleared the
     * moment one succeeds.
     */
    lastError: String
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
    /** No line carried an allocation from the coupon, so the whole order was used. */
    wholeOrderFallback: { type: Boolean, default: false },
    /** Why nothing is owed, in a sentence fit for the screen. */
    reason: String,
    /**
     * Paid, then the parcel came back. Nothing is reversed automatically —
     * this is a flag for somebody to act on, because money already sent is
     * recovered by agreement and not by a job editing a record.
     */
    needsReversal: { type: Boolean, default: false },
    computedAt: Date,

    /**
     * How this one commission was actually paid.
     *
     * Present only once an administrator has pressed Pay and said so — the money
     * moves outside this system, by UPI or bank transfer, and this is the record
     * that it did. `paidAt` is when the button was pressed; `paymentDate` is the
     * day the money left, which is usually the same day and occasionally is not.
     * The partner sees every field but `paidBy`.
     */
    payment: {
      paidAt: Date,
      paidBy: { type: Schema.Types.ObjectId, ref: "User" },
      paymentDate: String,
      mode: { type: String, enum: PAYOUT_MODES },
      /** A UTR, a UPI transaction id — whatever the partner can find on their side. */
      reference: String,
      note: String
    }
  },

  syncedAt: Date,
  notes: String
}, { timestamps: true });

// The two questions every screen asks: this rep's orders newest first, and
// what is payable right now — and, on the payments screen, what was paid when.
SalesOrderSchema.index({ rep: 1, placedAt: -1 });
SalesOrderSchema.index({ "commission.status": 1, "delivery.at": -1 });
SalesOrderSchema.index({ "commission.status": 1, "commission.payment.paidAt": -1 });
SalesOrderSchema.index({ "delivery.state": 1, placedAt: -1 });
/**
 * The processing screen's own question: what has not been sent to the courier
 * yet, oldest first — because the oldest unbooked order is the one somebody is
 * about to telephone about.
 */
SalesOrderSchema.index({ "shipment.awb": 1, placedAt: -1 });
/**
 * The courier filter, and the list of couriers behind it.
 *
 * The list is a `distinct` over the whole collection on every read of the order
 * list — deliberately unfiltered, so narrowing the screen cannot empty the
 * dropdown that widens it again. Without this index that is a collection scan
 * per page load; with it, it is a scan of the index alone.
 */
SalesOrderSchema.index({ "shipment.courier": 1 }, { sparse: true });

export const SalesOrder = models.SalesOrder ?? model("SalesOrder", SalesOrderSchema);

// ------------------------------------------------------------ every shop order

/**
 * Every order the shop has ever taken, whoever brought it in — the customer
 * base, one row per order, for ringing back.
 *
 * Deliberately a separate collection from `SalesOrder`. That one holds only the
 * orders a partner's coupon attributed and everything downstream of it — the
 * commission, the courier booking, the payout — assumes a partner behind each
 * row. Putting the other ninety per cent of the shop's orders in there would
 * put them on the picking list, in the revenue figures and in the payout
 * queries, with a null where the partner should be. This is a lighter record:
 * who bought what, when, whether it arrived, and what was said when somebody
 * rang them about it. Where the same order *is* attributed, `order` points at
 * the fuller record.
 */
const SalesShopOrderSchema = new Schema({
  shopifyOrderId: { type: String, required: true, unique: true, index: true },
  name: { type: String, index: true },
  orderNumber: Number,
  placedAt: { type: Date, required: true, index: true },

  /**
   * The same person across orders — see `customerKeyOf`. What lets the list
   * say "has bought twice before" without a join, via `customerOrders` below,
   * which the sync recounts for every key it touched.
   */
  customerKey: { type: String, required: true, index: true },
  customerOrders: { type: Number, default: 1 },
  customer: {
    name: String,
    email: String,
    phone: String,
    address1: String,
    address2: String,
    city: { type: String, index: true },
    state: String,
    pinCode: String,
    country: String
  },

  items: [new Schema({ title: String, quantity: Number, sku: String }, { _id: false })],
  /** Titles, de-duplicated, so the product filter is an indexed equality. */
  products: { type: [String], default: [], index: true },
  total: { type: Number, default: 0 },
  paymentMethod: String,
  financialStatus: String,
  /** Shopify's own word for the parcel: the only delivery fact for an order Shiprocket was never asked about. */
  fulfilment: { type: String, enum: FULFILMENT_STATES, default: "Unfulfilled", index: true },
  cancelledAt: Date,
  discountCodes: { type: [String], default: [], index: true },

  /** Set when a partner's coupon brought this order in — the fuller record and its owner. */
  order: { type: Schema.Types.ObjectId, ref: "SalesOrder" },
  rep: { type: Schema.Types.ObjectId, ref: "SalesRep", index: true },
  couponCode: String,

  /**
   * What the courier said, when the courier was asked. Read off Shiprocket's
   * feed by order name on the same pass that walks the attributed orders, so an
   * order nobody's coupon brought in still says "Delivered" here.
   */
  delivery: {
    state: { type: String, enum: DELIVERY_STATES, index: true },
    status: String,
    courier: String,
    awb: String,
    deliveredAt: Date,
    checkedAt: Date
  },

  /** The calling desk's half of the row. */
  retarget: {
    status: { type: String, enum: RETARGET_STATUSES, default: "Not called", index: true },
    lastContactedAt: { type: Date, index: true },
    contactCount: { type: Number, default: 0 },
    /** Cached off `remarks`, so "never remarked" is a filter and not a scan. */
    remarkCount: { type: Number, default: 0 },
    lastChannel: { type: String, enum: REMARK_CHANNELS },
    lastRemarkAt: Date,
    lastRemark: String,
    nextFollowUpAt: { type: Date, index: true },
    /** The standing note — what to know before dialling. */
    notes: String,
    /** The right number, when the one the shop had was wrong. Wins over `customer.phone` on screen and in the search. */
    phone: String,
    remarks: [new Schema({
      text: { type: String, required: true, trim: true },
      channel: { type: String, enum: REMARK_CHANNELS, default: "Call" },
      status: { type: String, enum: RETARGET_STATUSES },
      at: { type: Date, default: Date.now },
      by: { type: Schema.Types.ObjectId, ref: "User" },
      byName: String
    }, { _id: true })]
  },

  syncedAt: Date
}, { timestamps: true });

// The list's default question, and the calling desk's own: what has not been
// rung, oldest order first; and what is due to be rung today.
SalesShopOrderSchema.index({ "retarget.status": 1, placedAt: -1 });
SalesShopOrderSchema.index({ "retarget.nextFollowUpAt": 1, placedAt: -1 });
SalesShopOrderSchema.index({ "customer.phone": 1 });

export const SalesShopOrder = models.SalesShopOrder ?? model("SalesShopOrder", SalesShopOrderSchema);

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
 * first anybody learns that it stopped is a partner asking why nothing has been
 * delivered for a fortnight.
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

  /** The standing description — what to know *before* dialling. */
  notes: String,

  /**
   * What was said, one line per conversation.
   *
   * Embedded rather than a collection of its own: a remark is never read apart
   * from the lead it is about, there are a handful per lead rather than
   * thousands, and the alternative costs a join on every row of a list somebody
   * scrolls for ten minutes. The log screen reaches across leads with `$unwind`,
   * which is the one query that would have wanted a collection and gets by
   * without one.
   *
   * `byName` is a snapshot beside the reference on purpose (§4.10): the trail
   * has to still read "Priya — no answer" after Priya's account is gone, and a
   * dangling `by` populates to null.
   */
  remarks: [new Schema({
    text: { type: String, required: true, trim: true },
    channel: { type: String, enum: REMARK_CHANNELS, default: "Note" },
    /** The status this conversation moved the lead to, when it moved it. */
    status: { type: String, enum: LEAD_STATUSES },
    at: { type: Date, default: Date.now },
    by: { type: Schema.Types.ObjectId, ref: "User" },
    byName: String
  }, { _id: true })],

  createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  updatedBy: { type: Schema.Types.ObjectId, ref: "User" }
}, { timestamps: true });

// The two questions the list screen asks: this trade, alphabetically, and
// whatever still needs ringing, newest first.
SalesLeadSchema.index({ type: 1, name: 1 });
SalesLeadSchema.index({ status: 1, createdAt: -1 });
// The log screen's own question: what was said lately, across every lead.
SalesLeadSchema.index({ "remarks.at": -1 });

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

  /**
   * What the last parcel was booked as, so the next one is not typed again.
   *
   * Kept here rather than asked for every time because a company ships one or
   * two things: the carton is the same carton, and it leaves from the same
   * warehouse. Written on every successful booking rather than edited on a
   * settings screen — the honest default for "what size is a parcel" is
   * whatever the last one was, and a screen asking the question would be a
   * screen somebody has to remember to update.
   */
  fulfilment: {
    pickupLocation: String,
    weight: Number,
    length: Number,
    breadth: Number,
    height: Number,
    /** How the courier was chosen last time — a rule, or a named one. */
    courierRule: { type: String, enum: COURIER_RULES },
    courierId: Number,
    courierName: String
  },

  rules: { type: [RuleSchema], default: () => DEFAULT_RULES },
  /** How far back a first sync reaches when nothing has ever been pulled. */
  backfillDays: { type: Number, min: 1, max: 730, default: DEFAULT_BACKFILL_DAYS },
  currency: { type: String, default: "INR" }
}, { timestamps: true });

export const SalesSettings = models.SalesSettings ?? model("SalesSettings", SalesSettingsSchema);
