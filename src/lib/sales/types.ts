import type { CommissionRule } from "./commission";
import type { CommissionStatus, DeliveryState, OrderSource, PayoutMode, PayoutStatus } from "./constants";

/**
 * The shapes the browser reads back.
 *
 * Pure, and deliberately not the mongoose documents: a screen receives plain
 * JSON with ids as strings and dates as ISO text, and typing it against the
 * schema would promise `ObjectId` and `Date` that never survive the wire.
 */

export type Id = string;

export type RepCoupon = { code: string; suffix: string; active: boolean; note?: string };

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

export type SalesOrderRecord = {
  _id: Id;
  source: OrderSource;
  shopifyOrderId?: string;
  name: string;
  placedAt: string;
  currency: string;
  customer?: { name?: string; email?: string; phone?: string; city?: string; state?: string; pinCode?: string };
  couponCode?: string;
  rep?: { _id: Id; name: string; code: string } | Id | null;
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
    maturesAt?: string;
    wholeOrderFallback?: boolean;
    reason?: string;
    needsReversal?: boolean;
    payout?: Id;
  };
  syncedAt?: string;
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

export type PayoutLineRecord = {
  _id: Id;
  run: Id;
  rep: { _id: Id; name: string; code: string } | Id;
  snapshot: {
    name?: string; code?: string; phone?: string;
    payMethod?: PayoutMode; upiId?: string; bankName?: string; bankAccountLastFour?: string; panNumber?: string;
  };
  orders: { order: Id; name?: string; placedAt?: string; deliveredAt?: string; base: number; rate: number; amount: number }[];
  orderCount: number;
  gross: number;
  adjustments: { name: string; amount: number }[];
  net: number;
  note?: string;
};

export type PayoutRecord = {
  _id: Id;
  payoutNo: string;
  financialYear: string;
  from: string;
  to: string;
  status: PayoutStatus;
  holdDays: number;
  totals: { reps: number; orders: number; gross: number; net: number };
  generatedAt?: string;
  approvedAt?: string;
  paidAt?: string;
  paymentDate?: string;
  paymentMode?: PayoutMode;
  reference?: string;
  note?: string;
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
  holdDays: number;
  payoutWeekday: number;
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
  ({ Pending: 0, Maturing: 0, Payable: 0, "In payout": 0, Paid: 0, Void: 0 });

/** A blank sync report, for a pass to fill in as it goes. */
export const emptyReport = (): SyncReport => ({
  ordersSeen: 0, ordersAttributed: 0, ordersSkipped: 0, ordersCreated: 0, ordersUpdated: 0,
  shipmentsMatched: 0, shipmentsUnmatched: 0, commissionsRecalculated: 0,
  unknownCoupons: [], warnings: []
});
