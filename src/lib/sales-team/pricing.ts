import type { TeamPaymentMode } from "./orders";

/**
 * What an order costs, by the Sales Team Handbook — worked out, never typed.
 *
 * The handbook is the company's price list and its discount rules in one: 20%
 * off MRP for a single product, 30% for two or more different products, a fixed
 * offer price on the Anti-Pigmentation Kit, no discount on the Testing Kit, ₹50
 * more off when the customer pays in advance, and an extra 10% the executive may
 * release only on a combo or the Kit, only on a prepaid or part-paid order, and
 * never below the Kit's floor. Every figure an executive quotes on a call comes
 * out of `quote()`, and the server recomputes the same figure before anything is
 * stored (§4.2) — so the price on the order is the price the handbook allows,
 * whatever was typed.
 *
 * Pure and tested against the handbook's own ready-to-quote sheets.
 */

export const CATALOGUE_KINDS = ["Product", "Kit", "Testing kit", "Gift"] as const;
export type CatalogueKind = (typeof CATALOGUE_KINDS)[number];

export type CatalogueItem = {
  /** Stable key — what an order line names. */
  id: string;
  name: string;
  kind: CatalogueKind;
  /** The printed price. Every percentage discount is worked out on this. */
  mrp: number;
  /** A Kit's fixed offer price — the handbook's opening quote. */
  offerPrice?: number;
  /** A Kit's absolute floor, per kit. */
  floor?: number;
  sku?: string;
  /** What it is, in a few words, for the executive on the call. */
  note?: string;
  active: boolean;
};

export type PricingRules = {
  /** % off MRP for a single product on its own. */
  singlePct: number;
  /** % off MRP for two or more different products. */
  comboPct: number;
  /** Rupees off when the customer pays everything in advance. */
  prepaidOff: number;
  /** The negotiable extra %, on the running price, combos and Kit only, never COD. */
  extraPct: number;
  /** The booking advance on a part payment. */
  partialAdvance: number;
};

/** The handbook, v1.0, effective 21 September 2026. */
export const DEFAULT_RULES: PricingRules = { singlePct: 20, comboPct: 30, prepaidOff: 50, extraPct: 10, partialAdvance: 150 };

export const DEFAULT_CATALOGUE: CatalogueItem[] = [
  { id: "face-wash", name: "Face Wash 100 ml", kind: "Product", mrp: 399, sku: "BHX-FW-100", note: "Glycolic 2% + Lactic — clears pores, brightens. Entry product.", active: true },
  { id: "serum", name: "Vitamin-C Face Serum 30 ml", kind: "Product", mrp: 799, sku: "BHX-VCS-30", note: "Vitamin C 10% + Ferulic 1% — dark spots, dullness, glow. Always with sunscreen.", active: true },
  { id: "moisturizer", name: "Face Moisturizer 50 g", kind: "Product", mrp: 599, sku: "BHX-MOI-50", note: "Ceramides 1%, oil-free — barrier repair, dryness, sensitive skin.", active: true },
  { id: "sunscreen", name: "Sunscreen SPF 50 — 50 g", kind: "Product", mrp: 499, sku: "BHX-SPF-50", note: "SPF 50 PA++++ + Niacinamide — tanning, protects every other result.", active: true },
  { id: "pigmentation-kit", name: "Skin Anti-Pigmentation Kit", kind: "Kit", mrp: 2299, offerPrice: 1499, floor: 1300, sku: "BHX-KIT-AP", note: "All four products. Pigmentation, melasma, overall glow.", active: true },
  { id: "testing-kit", name: "Testing Kit (trial pack)", kind: "Testing kit", mrp: 399, sku: "BHX-KIT-TRY", note: "Trial sizes. ₹399 flat — no discount except ₹50 prepaid.", active: true },
  { id: "free-bag", name: "Free Bag", kind: "Gift", mrp: 0, sku: "BHX-BAG", note: "Give it when the Kit closes at the floor.", active: true }
];

export const FREE_BAG_ID = "free-bag";

const rupee = (value: number) => Math.round(value);

export type QuoteInput = {
  catalogue: readonly CatalogueItem[];
  rules: PricingRules;
  items: readonly { catalogueId: string; quantity: number }[];
  paymentMode: TeamPaymentMode;
  /** The executive has released the extra discount. Ignored where it is not allowed. */
  extra?: boolean;
  freeBag?: boolean;
};

export type QuoteLine = { catalogueId: string; title: string; sku?: string; kind: CatalogueKind; quantity: number; mrp: number };

export type Quote = {
  lines: QuoteLine[];
  /** What the order is called for the price sheet: "Single", "Combo", "Kit"… */
  label: string;
  mrpTotal: number;
  /** After the standard offer (20% / 30% / Kit price), before prepaid and extra. */
  offerTotal: number;
  prepaidOff: number;
  /** Whether the extra discount may be offered on this order at all, and if not, why. */
  extraAllowed: boolean;
  extraReason?: string;
  extraOff: number;
  total: number;
  /** MRP total less total — the discount written onto the order. */
  discount: number;
  /** The booking advance a part payment collects by default. */
  partialAdvance: number;
  /** Something the handbook forbids that the quote had to hold back, for the screen to say. */
  warnings: string[];
};

/**
 * The price of an order, by the handbook.
 *
 * Products are grouped: core products are a Single (one product, any quantity —
 * 20%) or a Combo (two or more different ones — 30%), taken on their MRP total
 * and rounded to the rupee as the price sheets are. Kits are their fixed offer
 * price, the Testing Kit its MRP. Then ₹50 off the order on Prepaid, then — only
 * if released, and only on the combo and Kit part — the extra 10% on the running
 * price, held above each Kit's floor.
 */
export function quote(input: QuoteInput): Quote {
  const byId = new Map(input.catalogue.map(item => [item.id, item]));
  const warnings: string[] = [];

  // One line per catalogue item, quantities merged; unknown and inactive items dropped.
  const merged = new Map<string, number>();
  for (const row of input.items) {
    const item = byId.get(row.catalogueId);
    const quantity = Math.max(0, Math.round(Number(row.quantity) || 0));
    if (!item || !item.active || item.kind === "Gift" || !quantity) continue;
    merged.set(item.id, (merged.get(item.id) ?? 0) + quantity);
  }
  const lines: QuoteLine[] = [...merged].map(([id, quantity]) => {
    const item = byId.get(id)!;
    return { catalogueId: id, title: item.name, sku: item.sku, kind: item.kind, quantity, mrp: item.mrp };
  });

  const products = lines.filter(line => line.kind === "Product");
  const kits = lines.filter(line => line.kind === "Kit");
  const testing = lines.filter(line => line.kind === "Testing kit");

  const combo = products.length >= 2;
  const productMrp = products.reduce((sum, line) => sum + line.mrp * line.quantity, 0);
  const productOffer = rupee(productMrp * (1 - (combo ? input.rules.comboPct : input.rules.singlePct) / 100));
  const kitOffer = kits.reduce((sum, line) => sum + (byId.get(line.catalogueId)?.offerPrice ?? line.mrp) * line.quantity, 0);
  const testingOffer = testing.reduce((sum, line) => sum + line.mrp * line.quantity, 0);

  const mrpTotal = lines.reduce((sum, line) => sum + line.mrp * line.quantity, 0);
  const offerTotal = productOffer + kitOffer + testingOffer;
  const prepaidOff = input.paymentMode === "Prepaid" && offerTotal > 0 ? Math.min(input.rules.prepaidOff, offerTotal) : 0;

  // The extra 10%: combos and Kits only, and never on cash on delivery.
  const eligible = (combo ? productOffer : 0) + kitOffer;
  let extraAllowed = eligible > 0 && input.paymentMode !== "COD";
  let extraReason: string | undefined;
  if (!eligible) extraReason = "The extra discount is only for combos and the Kit.";
  else if (input.paymentMode === "COD") { extraReason = "The extra discount is never given on cash on delivery."; extraAllowed = false; }

  let extraOff = 0;
  if (input.extra && extraAllowed) {
    // Taken on the running price: the ₹50 prepaid comes off the eligible part first.
    const running = eligible - Math.min(prepaidOff, eligible);
    extraOff = rupee((running * input.rules.extraPct) / 100);
    // Never below a Kit's floor. Held at the floor rather than refused, and said.
    const kitFloor = kits.reduce((sum, line) => sum + (byId.get(line.catalogueId)?.floor ?? 0) * line.quantity, 0);
    if (kits.length && !combo && kitFloor && kitOffer - Math.min(prepaidOff, kitOffer) - extraOff < kitFloor) {
      extraOff = Math.max(0, kitOffer - Math.min(prepaidOff, kitOffer) - kitFloor);
      warnings.push(`The Kit cannot go below ₹${kitFloor.toLocaleString("en-IN")}. Offer the free bag instead.`);
    }
  } else if (input.extra && !extraAllowed && extraReason) {
    warnings.push(extraReason);
  }

  if (input.freeBag) {
    const bag = byId.get(FREE_BAG_ID);
    if (bag?.active) lines.push({ catalogueId: bag.id, title: bag.name, sku: bag.sku, kind: "Gift", quantity: 1, mrp: 0 });
  }

  const total = Math.max(0, offerTotal - prepaidOff - extraOff);
  const label = kits.length && !products.length && !testing.length ? "Kit"
    : combo ? `Combo (${products.length} products)`
    : products.length && !kits.length && !testing.length ? "Single product"
    : testing.length && !products.length && !kits.length ? "Testing kit"
    : lines.length ? "Mixed order" : "Empty";

  return {
    lines, label, mrpTotal, offerTotal, prepaidOff, extraAllowed, extraReason, extraOff, total,
    discount: Math.max(0, mrpTotal - total), partialAdvance: input.rules.partialAdvance, warnings
  };
}

/** The same order priced in each payment mode, for the executive to read out. */
export function quoteByMode(input: Omit<QuoteInput, "paymentMode">) {
  return {
    COD: quote({ ...input, paymentMode: "COD", extra: false }),
    Prepaid: quote({ ...input, paymentMode: "Prepaid" }),
    Partial: quote({ ...input, paymentMode: "Partial" })
  };
}

/** A stored catalogue as today's, filling gaps from the handbook so the form never opens empty. */
export function catalogueOf(stored: readonly CatalogueItem[] | null | undefined): CatalogueItem[] {
  return stored?.length ? [...stored] : DEFAULT_CATALOGUE.map(item => ({ ...item }));
}

export const rulesOf = (stored: Partial<PricingRules> | null | undefined): PricingRules => ({ ...DEFAULT_RULES, ...(stored ?? {}) });
