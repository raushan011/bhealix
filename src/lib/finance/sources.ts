/**
 * Every kind of bill this company *receives*, named once.
 *
 * The direction matters and is the reason this lives nowhere near `lib/billing`.
 * That module is money owed **to** the company — an invoice raised on a doctor,
 * chased, receipted. This is the other side of the ledger entirely: what
 * Shiprocket, Razorpay, Shopify and Meta charged **us**, which is the paperwork
 * the GST input credit sits on and the bundle the accountant asks for on the
 * fifth of every month.
 *
 * Pure, and free of Mongoose, so the browser and the server describe a source
 * with the same words and the checklist cannot drift from the filter beside it.
 *
 * Shiprocket appears three times deliberately. They are three different
 * documents raised by three different parts of that company against three
 * different expenses, and a CA reconciles them separately — the wallet recharge
 * is prepaid freight, the order invoice is the tax invoice for a shipment, and
 * the checkout charge is a commission on a sale. Folding them into one
 * "Shiprocket" row is exactly the sort of tidiness that produces a mismatched
 * return.
 */

/**
 * How a month's worth of a source arrives in the vault.
 *
 * `pull` means this application can go and fetch it, and the sync button does.
 * `upload` means it cannot, and is honest about why: the vendor publishes the
 * document in their own dashboard and exposes no API for it, so the vault's job
 * is to be the place it is filed once downloaded, to say when it is missing, and
 * to hand it back with everything else in one archive.
 */
export type Collection = "pull" | "upload";

export type SourceKey =
  | "shiprocket-recharge"
  | "shiprocket-order"
  | "shiprocket-checkout"
  | "razorpay"
  | "shopify"
  | "meta-ads"
  | "other";

export type Source = {
  key: SourceKey;
  /** The company that raised it. Two sources from one vendor group under it. */
  vendor: string;
  label: string;
  blurb: string;
  collection: Collection;
  /** Where a person goes to download it by hand. Shown beside every upload box. */
  billingUrl?: string;
  /**
   * Whether an empty month is worth flagging.
   *
   * "Other" is not: a month with no offline bills in it is an ordinary month.
   * Every named vendor is, because a missing Meta invoice is not noticed until
   * the return is being filed.
   */
  expected: boolean;
};

export const SOURCES: readonly Source[] = [
  {
    key: "shiprocket-recharge",
    vendor: "Shiprocket",
    label: "Wallet recharge",
    blurb: "The receipts for money put into the Shiprocket wallet, which is the freight paid in advance.",
    collection: "upload",
    billingUrl: "https://app.shiprocket.in/billing",
    expected: true
  },
  {
    key: "shiprocket-order",
    vendor: "Shiprocket",
    label: "Order tax invoices",
    blurb: "The tax invoice raised against each shipment. Pulled straight from Shiprocket using the credentials already held under Sales settings.",
    collection: "pull",
    billingUrl: "https://app.shiprocket.in/orders",
    expected: true
  },
  {
    key: "shiprocket-checkout",
    vendor: "Shiprocket",
    label: "Checkout charges",
    blurb: "What Shiprocket Checkout bills for the cart it powers — a different product on a different bill from the freight.",
    collection: "upload",
    billingUrl: "https://checkout.shiprocket.in/",
    expected: true
  },
  {
    key: "razorpay",
    vendor: "Razorpay",
    label: "Gateway fees",
    blurb: "Razorpay's own monthly tax invoice for what it charged on the payments it collected.",
    collection: "upload",
    billingUrl: "https://dashboard.razorpay.com/app/settings/invoices",
    expected: true
  },
  {
    key: "shopify",
    vendor: "Shopify",
    label: "Subscription & apps",
    blurb: "The shop's own bill: the plan, the apps on it and any transaction fees.",
    collection: "upload",
    billingUrl: "https://admin.shopify.com/settings/billing",
    expected: true
  },
  {
    key: "meta-ads",
    vendor: "Meta",
    label: "Ads billing",
    blurb: "What was spent on Facebook and Instagram advertising, as Meta's receipts for the month.",
    collection: "upload",
    billingUrl: "https://business.facebook.com/billing_hub/accounts",
    expected: true
  },
  {
    key: "other",
    vendor: "Other",
    label: "Offline & other",
    blurb: "Anything that arrived on paper or by email — the accountant's own fee, rent, a courier's manual bill.",
    collection: "upload",
    expected: false
  }
];

const BY_KEY = new Map(SOURCES.map(source => [source.key, source]));

export const SOURCE_KEYS = SOURCES.map(source => source.key) as readonly SourceKey[];

export const isSourceKey = (value: unknown): value is SourceKey =>
  typeof value === "string" && BY_KEY.has(value as SourceKey);

/**
 * A source by its key.
 *
 * Falls back to "Offline & other" rather than throwing, because the caller is
 * usually rendering a row: a document filed under a source that a later release
 * renamed should appear in the list under a sensible heading, not take the
 * screen down.
 */
export const sourceOf = (key: string): Source => BY_KEY.get(key as SourceKey) ?? BY_KEY.get("other")!;

/** "Shiprocket — wallet recharge". How one source reads in a sentence or a file name. */
export const sourceTitle = (key: string) => {
  const source = sourceOf(key);
  return source.vendor === "Other" ? source.label : `${source.vendor} — ${source.label.toLowerCase()}`;
};

/** The vendors in the order they should be listed, each with its sources under it. */
export const SOURCES_BY_VENDOR: readonly { vendor: string; sources: readonly Source[] }[] =
  [...new Set(SOURCES.map(source => source.vendor))].map(vendor => ({
    vendor,
    sources: SOURCES.filter(source => source.vendor === vendor)
  }));

/** The sources a month is judged complete against. */
export const EXPECTED_SOURCES = SOURCES.filter(source => source.expected);
