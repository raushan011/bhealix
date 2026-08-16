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

/**
 * The companies this vault can hold an API key for. One per vendor rather than
 * per source, because Shiprocket's three documents are all reached with the same
 * login.
 */
export const CONNECTORS = ["shiprocket", "razorpay", "shopify", "meta"] as const;
export type ConnectorKey = (typeof CONNECTORS)[number];

/**
 * What comes back when a source is pulled, and the difference matters to whoever
 * files the return.
 *
 * `document` is the vendor's **own tax invoice**, fetched as they issued it —
 * the piece of paper the input credit is actually claimed on.
 *
 * `statement` is a sheet this application builds from what the vendor's API will
 * tell it: every transaction for the month with the fee and the tax on it, and
 * the totals. It is real data pulled with a real key, and it is *not* a tax
 * invoice. Several of these companies publish the figures on an API and the
 * invoice itself only in their dashboard, and pretending otherwise would leave
 * somebody claiming credit against a spreadsheet. The screen says which is
 * which, and a source that only yields a statement still asks for its PDF.
 */
export type Yield = "document" | "statement";

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
  /** Which stored API key reaches it. Absent means nothing can fetch this one. */
  connector?: ConnectorKey;
  /** What a pull produces — the vendor's own invoice, or a statement built from their data. */
  yields?: Yield;
  /**
   * Said on the card when a pull cannot produce the tax invoice itself, so
   * nobody concludes the month is finished because a fetch succeeded.
   */
  stillNeedsPdf?: string;
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
    blurb: "The tax invoice raised against each shipment, fetched as Shiprocket issued it.",
    collection: "pull",
    connector: "shiprocket",
    yields: "document",
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
    blurb: "Every payment Razorpay collected in the month with the fee and the GST it charged on each, totalled — pulled with the API key.",
    collection: "pull",
    connector: "razorpay",
    yields: "statement",
    stillNeedsPdf: "Razorpay publishes the figures on its API and the monthly tax invoice only in the dashboard. File that PDF as well — the credit is claimed on it, not on this statement.",
    billingUrl: "https://dashboard.razorpay.com/app/settings/invoices",
    expected: true
  },
  {
    key: "shopify",
    vendor: "Shopify",
    label: "Subscription & apps",
    blurb: "The shop's own bill: the plan, the apps on it and any transaction fees.",
    collection: "pull",
    connector: "shopify",
    yields: "statement",
    stillNeedsPdf: "Shopify's Admin API exposes the payout and fee figures but not the monthly subscription invoice. File that PDF as well.",
    billingUrl: "https://admin.shopify.com/settings/billing",
    expected: true
  },
  {
    key: "meta-ads",
    vendor: "Meta",
    label: "Ads billing",
    blurb: "What was actually spent on Facebook and Instagram advertising in the month, read from the ad account.",
    collection: "pull",
    connector: "meta",
    yields: "statement",
    stillNeedsPdf: "Meta bills a card and publishes the receipt in Ads Manager only. File that PDF as well — this statement is the spend, not the invoice.",
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
