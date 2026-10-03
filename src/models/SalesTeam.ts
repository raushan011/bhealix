import { Schema, model, models } from "mongoose";
import { COURIER_RULES, DELIVERY_STATES } from "@/lib/sales/constants";
import { RISK_LEVELS } from "@/lib/sales-team/risk";
import { CATALOGUE_KINDS } from "@/lib/sales-team/pricing";
import {
  DEFAULT_INCENTIVE_RULES, INCENTIVE_PAY_MODES, INCENTIVE_STATUSES, INCENTIVE_TYPES, TEAM_ORDER_CHANNELS, TEAM_PAYMENT_MODES
} from "@/lib/sales-team/orders";

/**
 * The company's own sales team: the orders its executives place, and the
 * incentive each order earns.
 *
 * A separate collection from `SalesOrder`, which is the affiliate operation's —
 * orders a partner's coupon brought in through the shop. Mixing the two would
 * put a salaried employee's phone sale on an affiliate's payout screen and an
 * affiliate's commission on an employee's incentive statement, and every query
 * on either side would need a filter somebody would one day forget.
 *
 * What the two do share is the parcel. The field names under `items`,
 * `customer`, `totals`, `shipment` and `delivery` are deliberately the ones
 * `SalesOrder` uses, so a team order goes through `lib/sales/booking.ts` — the
 * same find-before-create, the same courier choice, the same airway bill — with
 * no second copy of any of it.
 */

const LineSchema = new Schema({
  /** The catalogue product, when it came from the CRM catalogue (direct orders). */
  product: { type: Schema.Types.ObjectId, ref: "Product" },
  /** The Shopify variant, when the line was chosen from the shop — which is what takes stock off there. */
  variantId: String,
  /** The sales catalogue item it was priced from — see `lib/sales-team/pricing.ts`. */
  catalogueId: String,
  /** The printed price per unit, as it stood when the order was placed. */
  mrp: Number,
  sku: String,
  title: { type: String, required: true, trim: true },
  quantity: { type: Number, required: true, min: 1 },
  /** Per unit, as the executive priced it. */
  price: { type: Number, required: true, min: 0 },
  /** The whole line — quantity × price — as `SalesOrder` stores it. */
  gross: { type: Number, default: 0 },
  /** Always zero; present so the booking code reads both kinds of order alike. */
  couponDiscount: { type: Number, default: 0 },
  /** This line's share of the order discount. */
  otherDiscount: { type: Number, default: 0 }
}, { _id: false });

const SalesTeamOrderSchema = new Schema({
  /**
   * What the customer and the courier call it. For an order placed through
   * Shopify — the default — this is the shop's own name, `#1042`, because that is
   * the `channel_order_id` Shiprocket files it under and the key the delivery
   * sync joins back on. For a direct order it is the CRM's own `ref`.
   */
  name: { type: String, required: true, unique: true, index: true },
  /** `BHX-SE-00042` — the CRM's own number, kept on every order whatever channel it went through. */
  ref: { type: String, index: true, sparse: true },
  /** Where the order was placed: in the Shopify store, or booked straight with the courier from here. */
  channel: { type: String, enum: TEAM_ORDER_CHANNELS, default: "Direct", index: true },
  /** Shopify's id for the order, when it was placed there. */
  shopifyOrderId: { type: String, unique: true, sparse: true, index: true },
  orderNumber: Number,
  placedAt: { type: Date, required: true, default: Date.now, index: true },

  /** Whose sale this is. Their incentive, their statement. */
  executive: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  /** Kept beside the reference so the order still says who sold it after an account is gone (§4.5). */
  executiveName: String,
  /** The lead it was converted from, when it was. */
  lead: { type: Schema.Types.ObjectId, ref: "SalesLead", index: true },
  /** Who pressed Save — the executive, or an administrator placing it for them. */
  createdBy: { type: Schema.Types.ObjectId, ref: "User" },

  customer: {
    name: String,
    email: String,
    phone: String,
    address1: String,
    address2: String,
    city: String,
    state: String,
    pinCode: String,
    country: { type: String, default: "India" }
  },

  items: { type: [LineSchema], default: [] },
  totals: {
    gross: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    /** What the order is worth: every line, less the discount. Named `paid` for the booking code. */
    paid: { type: Number, default: 0 }
  },

  /** How the customer pays — see `TEAM_PAYMENT_MODES`. */
  paymentMode: { type: String, enum: TEAM_PAYMENT_MODES, required: true, index: true },
  /** What the booking code reads: "COD" for COD and part payments, "Prepaid" otherwise. */
  paymentMethod: String,
  financialStatus: String,
  /** Received before dispatch: the advance on a part payment, the whole order when prepaid. */
  advancePaid: { type: Number, default: 0, min: 0 },
  /** The UPI or bank reference for whatever was paid up front. */
  paymentReference: String,
  /** What the courier collects at the door. A cache of `collectAmountOf`. */
  collectAmount: { type: Number, default: 0 },

  cancelledAt: Date,
  cancelReason: String,
  cancelledBy: { type: Schema.Types.ObjectId, ref: "User" },

  /** Read back from Shiprocket, and written when the parcel is booked — as on `SalesOrder`. */
  shipment: {
    shiprocketOrderId: String,
    shipmentId: String,
    awb: String,
    courier: String,
    status: String,
    statusCode: Number,
    deliveredAt: Date,
    /** The courier's estimate of the delivery day, `yyyy-mm-dd`, for the "delivering today" reminder. */
    expectedDelivery: String,
    checkedAt: Date,
    pickupLocation: String,
    courierId: Number,
    parcel: { weight: Number, length: Number, breadth: Number, height: Number },
    codAmount: Number,
    pickupScheduledAt: Date,
    pickupToken: String,
    processedAt: Date,
    processedBy: { type: Schema.Types.ObjectId, ref: "User" },
    lastError: String
  },

  delivery: {
    reported: { type: String, enum: DELIVERY_STATES, default: "Awaiting" },
    /** Set by an administrator when the courier's answer was wrong. Wins when set. */
    override: { type: String, enum: DELIVERY_STATES },
    overrideReason: String,
    overrideBy: { type: Schema.Types.ObjectId, ref: "User" },
    overrideAt: Date,
    state: { type: String, enum: DELIVERY_STATES, default: "Awaiting", index: true },
    at: Date
  },

  /**
   * What the order earns the executive.
   *
   * The rule is **frozen onto the order when it is placed** — mode, type and
   * value — so the incentive an executive was promised when they closed the sale
   * is the one they are paid, whatever the rules say next month. An
   * administrator can choose to re-price unpaid orders when changing a rule;
   * nothing does it silently.
   *
   * `status` and `amount` are a cache of `priceIncentive`, maintained by
   * `recalculateIncentive` alone (§4.4), and never restated once `Paid`.
   */
  incentive: {
    enabled: { type: Boolean, default: true },
    type: { type: String, enum: INCENTIVE_TYPES, default: "Percentage" },
    value: { type: Number, default: 0 },
    base: { type: Number, default: 0 },
    amount: { type: Number, default: 0 },
    status: { type: String, enum: INCENTIVE_STATUSES, default: "Pending", index: true },
    reason: String,
    needsReversal: { type: Boolean, default: false },
    computedAt: Date,
    payment: {
      paidAt: Date,
      paidBy: { type: Schema.Types.ObjectId, ref: "User" },
      paymentDate: String,
      mode: { type: String, enum: INCENTIVE_PAY_MODES },
      reference: String,
      note: String
    }
  },

  /**
   * How likely the parcel was to come back, as assessed when the order was
   * placed — kept so the executive and the desk can see what was known at the
   * time, and so returns can later be checked against the score.
   */
  rtoRisk: {
    level: { type: String, enum: RISK_LEVELS },
    score: Number,
    reasons: { type: [String], default: undefined },
    advice: String
  },

  /**
   * Every instruction sent to Shiprocket about a failed delivery — reattempt,
   * reschedule or return — with who sent it and what Shiprocket answered. Kept
   * as a list because a parcel can fail twice, and "we already asked for Saturday"
   * is worth knowing on the second call.
   */
  ndr: {
    type: [new Schema({
      action: { type: String, enum: ["re-attempt", "return"], required: true },
      deferredDate: String,
      phone: String,
      address1: String,
      address2: String,
      comments: String,
      ok: Boolean,
      response: String,
      at: { type: Date, default: Date.now },
      by: { type: Schema.Types.ObjectId, ref: "User" },
      byName: String
    }, { _id: true })],
    default: []
  },

  /**
   * How the handbook priced it, kept so the order explains its own figure: the
   * MRP, the standard offer, the ₹50 prepaid and any extra discount released.
   */
  pricing: {
    label: String,
    mrpTotal: Number,
    offerTotal: Number,
    prepaidOff: Number,
    extraOff: Number,
    extra: Boolean,
    freeBag: Boolean
  },

  notes: String
}, { timestamps: true });

// The questions every screen asks: one executive's orders newest first, what is
// owed to whom, and what has not been sent to the courier yet.
SalesTeamOrderSchema.index({ executive: 1, placedAt: -1 });
SalesTeamOrderSchema.index({ "incentive.status": 1, executive: 1 });
SalesTeamOrderSchema.index({ "delivery.state": 1, placedAt: -1 });
SalesTeamOrderSchema.index({ "shipment.awb": 1, placedAt: -1 });
// The executive's "today" screen: their parcels still moving, by expected day.
SalesTeamOrderSchema.index({ executive: 1, "delivery.state": 1, "shipment.expectedDelivery": 1 });

export const SalesTeamOrder = models.SalesTeamOrder ?? model("SalesTeamOrder", SalesTeamOrderSchema);

/**
 * How the sales team is paid, and how its parcels go out. One document, created
 * on first read (§4.11), because an incentive rate changes at the desk and not
 * in a deployment.
 *
 * The Shiprocket credentials are deliberately not here: there is one courier
 * account, kept in the Affiliate CRM's settings, and both operations book
 * through it.
 */
const SalesTeamSettingsSchema = new Schema({
  key: { type: String, default: "sales-team", unique: true, index: true },
  /**
   * Where executives' orders are placed. `Shopify` — the default — writes each
   * one into the store, tagged with the executive, so it is counted, stocked and
   * shipped like any shop order. `Direct` books the courier from here without
   * the shop ever hearing of it, for a store that is not connected.
   */
  orderChannel: { type: String, enum: TEAM_ORDER_CHANNELS, default: "Shopify" },
  /**
   * What the sales team sells and at what price — the handbook's MRP list — and
   * the discount rules applied to it. Empty means the handbook defaults apply
   * (`DEFAULT_CATALOGUE`, `DEFAULT_RULES`), so a fresh install prices correctly.
   */
  catalogue: {
    type: [new Schema({
      id: { type: String, required: true },
      name: { type: String, required: true },
      kind: { type: String, enum: CATALOGUE_KINDS, required: true },
      mrp: { type: Number, default: 0 },
      offerPrice: Number,
      floor: Number,
      sku: String,
      note: String,
      active: { type: Boolean, default: true }
    }, { _id: false })],
    default: undefined
  },
  pricing: { singlePct: Number, comboPct: Number, prepaidOff: Number, extraPct: Number, partialAdvance: Number },
  incentiveRules: {
    type: [new Schema({
      mode: { type: String, enum: TEAM_PAYMENT_MODES, required: true },
      enabled: { type: Boolean, default: true },
      type: { type: String, enum: INCENTIVE_TYPES, default: "Percentage" },
      value: { type: Number, min: 0, default: 0 }
    }, { _id: false })],
    default: () => DEFAULT_INCENTIVE_RULES
  },
  /** What the last team parcel was booked as, so the next one is not typed again. */
  fulfilment: {
    pickupLocation: String,
    weight: Number,
    length: Number,
    breadth: Number,
    height: Number,
    courierRule: { type: String, enum: COURIER_RULES },
    courierId: Number,
    courierName: String
  },
  lastShipmentSyncAt: Date,
  lastShipmentSyncError: String
}, { timestamps: true });

export const SalesTeamSettings = models.SalesTeamSettings ?? model("SalesTeamSettings", SalesTeamSettingsSchema);
