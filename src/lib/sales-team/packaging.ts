import type { Parcel } from "@/lib/sales/fulfilment";
import type { CatalogueItem, CatalogueKind } from "./pricing";

/**
 * What a sales-team parcel weighs and measures, worked out from the order
 * rather than typed in for each booking.
 *
 * Every order goes out in the same carton whatever is in it, so the parcel is
 * fully decided by two things the administrator sets once — what one product
 * weighs and what the empty packed carton weighs — and by how many products the
 * order holds. Typing it per booking is how a parcel gets declared at 0.5 kg in
 * a carton the courier measures at more, and Shiprocket bills the difference
 * back as a weight discrepancy.
 *
 * Shiprocket charges on the *applicable* weight: the higher of the dead weight
 * (what the scale says) and the volumetric weight (L × B × H ÷ 5000, in cm and
 * kg). Declaring the applicable weight is what keeps the courier's re-weigh from
 * ever coming back higher than the booking. Pure, so the settings screen can
 * show exactly what will be sent.
 */

/** Shiprocket's divisor for domestic volumetric weight: cm³ ÷ 5000 = kg. */
export const VOLUMETRIC_DIVISOR = 5000;

export const WEIGHT_BASES = ["applicable", "dead"] as const;
export type WeightBasis = (typeof WEIGHT_BASES)[number];

export const WEIGHT_BASIS_LABEL: Record<WeightBasis, string> = {
  applicable: "Higher of dead and volumetric weight (as Shiprocket bills)",
  dead: "Dead weight only (what the scale shows)"
};

export type PackagingRules = {
  /** One product, packed, in grams. */
  unitGrams: number;
  /** The empty carton and its filling, in grams. */
  packagingGrams: number;
  /** The carton, in centimetres. */
  length: number;
  breadth: number;
  height: number;
  basis: WeightBasis;
  /** How many products one catalogue item of each type counts as — a Kit is all four. */
  unitsPerKind: Record<CatalogueKind, number>;
};

export const DEFAULT_PACKAGING: PackagingRules = {
  unitGrams: 100,
  packagingGrams: 45,
  length: 19,
  breadth: 11,
  height: 7,
  basis: "applicable",
  unitsPerKind: { "Product": 1, "Kit": 4, "Testing kit": 1, "Gift": 0 }
};

/** The stored rules with anything missing taken from the defaults. */
export function packagingOf(stored?: Partial<PackagingRules> | null): PackagingRules {
  const number = (value: unknown, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  };
  const positive = (value: unknown, fallback: number) => number(value, fallback) > 0 ? number(value, fallback) : fallback;
  const kinds = stored?.unitsPerKind ?? {};
  return {
    unitGrams: number(stored?.unitGrams, DEFAULT_PACKAGING.unitGrams),
    packagingGrams: number(stored?.packagingGrams, DEFAULT_PACKAGING.packagingGrams),
    length: positive(stored?.length, DEFAULT_PACKAGING.length),
    breadth: positive(stored?.breadth, DEFAULT_PACKAGING.breadth),
    height: positive(stored?.height, DEFAULT_PACKAGING.height),
    basis: WEIGHT_BASES.includes(stored?.basis as WeightBasis) ? stored!.basis as WeightBasis : DEFAULT_PACKAGING.basis,
    unitsPerKind: Object.fromEntries(Object.entries(DEFAULT_PACKAGING.unitsPerKind).map(([kind, fallback]) =>
      [kind, number((kinds as Record<string, unknown>)[kind], fallback)])) as Record<CatalogueKind, number>
  };
}

/** Up to the next 10 g. Never down: a parcel declared light is the discrepancy this exists to prevent. */
const kg = (grams: number) => Math.ceil(Math.round(grams) / 10) / 100;

export const deadWeightKg = (units: number, rules: PackagingRules) =>
  kg(Math.max(0, units) * rules.unitGrams + rules.packagingGrams);

export const volumetricWeightKg = (rules: PackagingRules) =>
  kg((rules.length * rules.breadth * rules.height / VOLUMETRIC_DIVISOR) * 1000);

/** The weight declared to Shiprocket for a parcel of this many products. Never below Shiprocket's 0.01 kg. */
export function declaredWeightKg(units: number, rules: PackagingRules) {
  const dead = deadWeightKg(units, rules);
  return Math.max(0.01, rules.basis === "applicable" ? Math.max(dead, volumetricWeightKg(rules)) : dead);
}

/** How many products an order's lines hold, a Kit counting as everything in it. */
export function unitsIn(
  items: { catalogueId?: string | null; quantity?: number | null }[] | undefined,
  catalogue: CatalogueItem[],
  rules: PackagingRules
) {
  return (items ?? []).reduce((total, line) => {
    const kind = catalogue.find(item => item.id === line.catalogueId)?.kind;
    // A line from outside the catalogue is one product per unit — the honest guess.
    const per = kind ? rules.unitsPerKind[kind] : 1;
    return total + Math.max(0, Number(line.quantity) || 0) * per;
  }, 0);
}

/** The parcel to book, from the order's contents and the administrator's rules. */
export function parcelFor(units: number, rules: PackagingRules): Parcel {
  return { weight: declaredWeightKg(units, rules), length: rules.length, breadth: rules.breadth, height: rules.height };
}
