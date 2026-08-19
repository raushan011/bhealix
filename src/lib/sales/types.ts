import type { AutomationTrigger, OutreachStatus } from "./automation";
import type { CommissionRule } from "./commission";
import type { AutomationCounts } from "./outreach-engine";
import type { CommissionStatus, CourierRule, DeliveryState, OrderSource, PayoutMode } from "./constants";
import type { FulfilmentState, RetargetStatus } from "./retarget";
import type { Parcel, PickupLocation } from "./fulfilment";
import type { LeadSource, LeadStatus, RemarkChannel } from "./leads";
import type { CouponSetupState, RepStatus } from "./partners";

/**
 * The shapes the browser reads back.
 *
 * Pure, and deliberately not the mongoose documents: a screen receives plain
 * JSON with ids as strings and dates as ISO text, and typing it against the
 * schema would promise `ObjectId` and `Date` that never survive the wire.
 */

export type Id = string;

export type RepCoupon = {
  code: string;
  suffix: string;
  active: boolean;
  note?: string;
  /** Whether Shopify has it. Absent on every code issued before self-service — read as `Live`. */
  setup?: CouponSetupState;
  setupError?: string;
  issuedBy?: "Admin" | "Rep";
  issuedAt?: string;
};

export type SalesRepRecord = {
  _id: Id;
  code: string;
  name: string;
  phone?: string;
  email?: string;
  coupons: RepCoupon[];
  payMethod?: PayoutMode;
  upiId?: string;
  bankName?: string;
  bankAccountName?: string;
  bankAccountNo?: string;
  bankIfsc?: string;
  panNumber?: string;
  active: boolean;
  joinedAt?: string;
  notes?: string;
  createdAt?: string;

  /** The account, as opposed to the attribution switch — see `lib/sales/partners.ts`. */
  status?: RepStatus;
  reviewNote?: string;
  selfRegistered?: boolean;
  approvedAt?: string;
  lastLoginAt?: string;
  /** Whether they have a portal password. Never the hash itself. */
  hasLogin?: boolean;
};

/** One dated line about one conversation — see `lib/sales/leads.ts`. */
export type LeadRemark = {
  _id: Id;
  text: string;
  channel: RemarkChannel;
  /** Where this conversation left the lead, when it moved it at all. */
  status?: LeadStatus;
  at: string;
  /** Who wrote it, snapshotted — a remark outlives the account that wrote it. */
  byName?: string;
};

/** A remark with the lead it belongs to, as the log screen and the export read it. */
export type LeadRemarkRow = LeadRemark & {
  lead: {
    _id: Id;
    name: string;
    type: string;
    status: LeadStatus;
    phone?: string;
    area?: string;
    city?: string;
  };
};

/** A business found by the lead search and kept, as the screens read it back. */
export type SalesLeadRecord = {
  _id: Id;
  name: string;
  type: string;
  status: LeadStatus;
  phone?: string;
  website?: string;
  address?: string;
  area?: string;
  city?: string;
  googlePlaceId?: string;
  googleMapsUrl?: string;
  rating?: number;
  reviewCount?: number;
  latitude?: number;
  longitude?: number;
  searchQuery?: string;
  searchLocation?: string;
  source?: LeadSource;
  /** The standing note about the lead, as opposed to `remarks`, which is the thread. */
  notes?: string;
  remarks?: LeadRemark[];
  createdAt?: string;
  /** What the outreach queue has done to this lead — see `lib/sales/outreach.ts`. */
  lastContactedAt?: string;
  contactCount?: number;
};

export type SalesOrderItem = {
  sku?: string;
  title: string;
  quantity: number;
  gross: number;
  couponDiscount: number;
  otherDiscount: number;
  refunded: number;
};

/**
 * How one order's commission was paid, as every screen shows it.
 *
 * The admin sees who pressed the button; the partner sees everything else — the
 * day, the mode, the reference — because that is what they need to find the
 * money on their own side.
 */
export type CommissionPayment = {
  paidAt?: string;
  paidBy?: { _id: Id; name?: string } | Id;
  paymentDate?: string;
  mode?: PayoutMode;
  reference?: string;
  note?: string;
};

export type SalesOrderRecord = {
  _id: Id;
  source: OrderSource;
  shopifyOrderId?: string;
  name: string;
  placedAt: string;
  currency: string;
  customer?: {
    name?: string; email?: string; phone?: string;
    address1?: string; address2?: string; city?: string; state?: string; pinCode?: string; country?: string;
  };
  couponCode?: string;
  /** Populated with enough to pay them from the row, where the reader may pay. */
  rep?: {
    _id: Id; name: string; code: string; phone?: string;
    payMethod?: PayoutMode; upiId?: string; bankName?: string; bankAccountName?: string; bankAccountNo?: string; bankIfsc?: string;
  } | Id | null;
  /** Who the partner was, written on only when their record was deleted. */
  repSnapshot?: { name?: string; code?: string; deletedAt?: string };
  ruleSuffix?: string;
  discountCodes: string[];
  items: SalesOrderItem[];
  totals: { gross: number; discount: number; refunded: number; paid: number };
  financialStatus?: string;
  paymentMethod?: string;
  cancelledAt?: string;
  fullyRefunded: boolean;
  shipment?: {
    shiprocketOrderId?: string;
    shipmentId?: string;
    awb?: string;
    courier?: string;
    status?: string;
    statusCode?: number;
    deliveredAt?: string;
    checkedAt?: string;
    /** What was decided here when the order was booked — see `lib/sales/fulfilment.ts`. */
    pickupLocation?: string;
    courierId?: number;
    parcel?: { weight?: number; length?: number; breadth?: number; height?: number };
    codAmount?: number;
    pickupScheduledAt?: string;
    pickupToken?: string;
    processedAt?: string;
    lastError?: string;
  };
  delivery: {
    reported: DeliveryState;
    override?: DeliveryState;
    overrideReason?: string;
    state: DeliveryState;
    at?: string;
  };
  commission: {
    rate: number;
    base: number;
    amount: number;
    status: CommissionStatus;
    wholeOrderFallback?: boolean;
    reason?: string;
    needsReversal?: boolean;
    payment?: CommissionPayment;
  };
  syncedAt?: string;
};

// ------------------------------------------------------------------ processing

/**
 * What the processing screen needs before it can offer anything: the company's
 * own pickup addresses, and whatever the last parcel was booked as.
 */
export type FulfilmentOptions = {
  pickupLocations: PickupLocation[];
  defaults: {
    pickupLocation?: string;
    parcel: Parcel;
    courierRule: CourierRule;
    courierId?: number;
    courierName?: string;
  };
  /** Null when Shiprocket is connected; the sentence to show when it is not. */
  refusal: string | null;
};

/**
 * What became of one order in a batch.
 *
 * Every order gets a row whether it worked or not — a batch of forty that
 * reports "34 booked" and nothing else is a batch somebody has to go through by
 * hand to find the other six.
 */
export type ProcessResult = {
  orderId: Id;
  name: string;
  ok: boolean;
  awb?: string;
  courier?: string;
  /** Set when the parcel could not be booked, in the words to put on the screen. */
  error?: string;
};

/** What one rep has done, over whatever window the screen asked for. */
export type RepSummary = {
  rep: { _id: Id; name: string; code: string; active: boolean; phone?: string };
  orders: number;
  delivered: number;
  inTransit: number;
  returned: number;
  /** Money the customers actually paid on their attributed orders. */
  revenue: number;
  earned: Record<CommissionStatus, number>;
  /** Owed and not yet on a run — the figure that matters on payout day. */
  payable: number;
  paid: number;
};

// ------------------------------------------------------------ the rep's own portal

/**
 * What an affiliate is shown about themselves.
 *
 * A narrower record than `SalesRepRecord` on purpose, and the omissions are the
 * design: no `notes` (an administrator's private remarks about them), no
 * `createdBy`, no `approvedBy`. A portal is not a smaller admin panel.
 */
export type PartnerProfile = {
  _id: Id;
  name: string;
  code: string;
  email?: string;
  phone?: string;
  status: RepStatus;
  active: boolean;
  reviewNote?: string;
  coupons: RepCoupon[];
};

/** One published commission rule, as a rep is offered it. */
export type PartnerRule = {
  suffix: string;
  label: string;
  /** Their commission, as a percentage. */
  rate: number;
  /** What the customer gets off — a different figure, and never confused with the one above. */
  customerDiscount: string;
  /** Whether a code under it can be created in the shop immediately. */
  readyInShop: boolean;
  /** They already hold a live code under this rule. */
  held: boolean;
};

/** Everything the portal's home screen reads, in one response. */
export type PartnerOverview = {
  profile: PartnerProfile;
  /** Why they cannot act, when they cannot. Null is the ordinary case. */
  refusal: string | null;
  summary: Omit<RepSummary, "rep">;
  rules: PartnerRule[];
  maxCoupons: number;
};

/** An order as the rep's list draws it, with the sentence it opens with. */
export type PartnerOrderRecord = Omit<SalesOrderRecord, "rep" | "discountCodes" | "fullyRefunded"> & {
  headline: string;
  discountCodes?: string[];
  fullyRefunded?: boolean;
};

export type SalesSettingsRecord = {
  /** The redirect URL to register in the Dev Dashboard — the one the handshake really sends. */
  callbackUrl: string;
  /** `NEXT_PUBLIC_APP_URL` as the server sees it, so the screen can warn when it is wrong. */
  appUrl: string;
  shopifyDomain?: string;
  shopifyApiVersion: string;
  shopifyConnectedAt?: string;
  shopifyClientId?: string;
  /** Whether a secret is stored. Neither secret is ever sent to a browser. */
  shopifyClientSecretSet: boolean;
  /** What Shopify actually granted, comma-separated. */
  shopifyScopes?: string;
  /** Whether an access token is stored — earned by the handshake, or pasted. */
  shopifyTokenSet: boolean;
  shopifyTokenHint?: string;
  lastOrderSyncAt?: string;
  lastOrderSyncError?: string;

  shiprocketEmail?: string;
  shiprocketPasswordSet: boolean;
  lastShipmentSyncAt?: string;
  lastShipmentSyncError?: string;

  rules: CommissionRule[];
  backfillDays: number;
  currency: string;
};

/** What a sync did, in the words the screen reports it in. */
export type SyncReport = {
  ordersSeen: number;
  ordersAttributed: number;
  ordersSkipped: number;
  ordersCreated: number;
  ordersUpdated: number;
  shipmentsMatched: number;
  shipmentsUnmatched: number;
  commissionsRecalculated: number;
  /** Codes seen on orders that belong to no rep — very often a typo in Shopify. */
  unknownCoupons: string[];
  warnings: string[];
  /** How far back the order pull reached. An empty sync is only news if this is old. */
  ordersSince?: string;
  from?: string;
  to?: string;
};

// --------------------------------------------------------------- presentation

/** `₹1,499` — whole rupees, because that is what a commission is paid in. */
export const formatRupees = (value: number | null | undefined) =>
  `₹${Math.round(Number(value) || 0).toLocaleString("en-IN")}`;

/** An empty tally of every commission status, for summing into. */
export const emptyEarnings = (): Record<CommissionStatus, number> =>
  ({ Pending: 0, Payable: 0, Paid: 0, Void: 0 });

/** A blank sync report, for a pass to fill in as it goes. */
export const emptyReport = (): SyncReport => ({
  ordersSeen: 0, ordersAttributed: 0, ordersSkipped: 0, ordersCreated: 0, ordersUpdated: 0,
  shipmentsMatched: 0, shipmentsUnmatched: 0, commissionsRecalculated: 0,
  unknownCoupons: [], warnings: []
});

// ------------------------------------------------------------- retargeting

/** One line of what was said to a shop customer about one order. */
export type RetargetRemark = {
  _id: Id;
  text: string;
  channel: RemarkChannel;
  status?: RetargetStatus;
  at: string;
  byName?: string;
};

/** Every Shopify order, as the retargeting screen draws it. */
export type ShopOrderRecord = {
  _id: Id;
  shopifyOrderId: string;
  name: string;
  orderNumber?: number;
  placedAt: string;
  customerKey: string;
  customerOrders: number;
  customer: {
    name?: string; email?: string; phone?: string;
    address1?: string; address2?: string; city?: string; state?: string; pinCode?: string; country?: string;
  };
  items: { title: string; quantity: number; sku?: string }[];
  products: string[];
  total: number;
  paymentMethod?: string;
  financialStatus?: string;
  fulfilment: FulfilmentState;
  cancelledAt?: string | null;
  discountCodes: string[];
  order?: Id | null;
  rep?: { _id: Id; name: string; code: string } | Id | null;
  couponCode?: string | null;
  delivery?: {
    state?: DeliveryState;
    status?: string;
    courier?: string;
    awb?: string;
    deliveredAt?: string;
    checkedAt?: string;
  };
  retarget: {
    status: RetargetStatus;
    lastContactedAt?: string;
    contactCount: number;
    remarkCount: number;
    lastChannel?: RemarkChannel;
    lastRemarkAt?: string;
    lastRemark?: string;
    nextFollowUpAt?: string;
    notes?: string;
    phone?: string;
    remarks: RetargetRemark[];
  };
  syncedAt?: string;
};

// ------------------------------------------------------------- automation

/** A rule as the panel reads it, with its figures beside it. */
export type AutomationRuleRecord = {
  _id: Id;
  name: string;
  enabled: boolean;
  leadType: string;
  city: string;
  freshOnly: boolean;
  template: { name: string; language: string; body: string; fields: string[] };
  stats: { queued: number; sent: number; replied: number; failed: number };
  /** How many saved leads the rule would fire for right now. */
  matching: number;
  createdAt?: string;
  updatedAt?: string;
};

/** Everything the automation panel paints from, in one response. */
export type AutomationOverview = {
  connected: boolean;
  autoSend: boolean;
  dailyCap: number;
  phoneNumberId: string;
  businessAccountId: string;
  apiVersion: string;
  /** Whether a token is stored — the token itself never reaches a browser. */
  accessTokenSet: boolean;
  accessTokenHint?: string;
  appSecretSet: boolean;
  verifyToken: string;
  displayNumber: string;
  connectedAt?: string;
  lastError?: string;
  /** The address to paste into Meta's webhook configuration. */
  webhookUrl: string;
  mayEdit: boolean;
  counts: AutomationCounts;
  rules: AutomationRuleRecord[];
};

/** One automated message in the log. */
export type OutreachMessageRecord = {
  _id: Id;
  lead?: Id;
  leadName?: string;
  leadType?: string;
  city?: string;
  phone: string;
  rule?: Id;
  ruleName?: string;
  templateName?: string;
  preview?: string;
  trigger?: AutomationTrigger;
  status: OutreachStatus;
  error?: string;
  queuedAt?: string;
  sentAt?: string;
  deliveredAt?: string;
  readAt?: string;
  repliedAt?: string;
  createdAt?: string;
};

/** One reply in the inbox. */
export type OutreachReplyRecord = {
  _id: Id;
  lead?: Id;
  leadName?: string;
  phone: string;
  profileName?: string;
  type?: string;
  text: string;
  receivedAt: string;
  seen: boolean;
};
