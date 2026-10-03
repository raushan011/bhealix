import { describe, expect, it } from "vitest";
import { DEFAULT_CATALOGUE, DEFAULT_RULES, quote, quoteByMode, type QuoteInput } from "./pricing";

const q = (items: QuoteInput["items"], paymentMode: QuoteInput["paymentMode"], extra = false, freeBag = false) =>
  quote({ catalogue: DEFAULT_CATALOGUE, rules: DEFAULT_RULES, items, paymentMode, extra, freeBag });
const one = (catalogueId: string, quantity = 1) => ({ catalogueId, quantity });

// Every expected figure below is read straight off the handbook's sheets (Section 7).
describe("single products — 20% off MRP, ₹50 more on prepaid", () => {
  it.each([
    ["face-wash", 319, 269],
    ["serum", 639, 589],
    ["moisturizer", 479, 429],
    ["sunscreen", 399, 349]
  ])("%s: ₹%i standard, ₹%i prepaid", (id, standard, prepaid) => {
    expect(q([one(id)], "COD").total).toBe(standard);
    expect(q([one(id)], "Partial").total).toBe(standard);
    expect(q([one(id)], "Prepaid").total).toBe(prepaid);
  });

  it("never allows the extra 10% on a single product", () => {
    const result = q([one("serum")], "Prepaid", true);
    expect(result.extraAllowed).toBe(false);
    expect(result.total).toBe(589);
    expect(result.warnings[0]).toMatch(/combos and the Kit/);
  });

  it("treats two of the same product as a single, not a combo", () => {
    expect(q([one("face-wash", 2)], "COD")).toMatchObject({ label: "Single product", total: 638 });
  });
});

describe("combos — 30% off MRP", () => {
  it.each([
    [["face-wash", "moisturizer"], 699, 649, 584, 629],
    [["face-wash", "sunscreen"], 629, 579, 521, 566],
    [["serum", "sunscreen"], 909, 859, 773, 818],
    [["face-wash", "serum", "moisturizer"], 1258, 1208, 1087, 1132],
    [["face-wash", "moisturizer", "sunscreen"], 1048, 998, 898, 943],
    [["serum", "moisturizer", "sunscreen"], 1328, 1278, 1150, 1195]
  ])("%j: standard %i, prepaid %i, prepaid floor %i, partial+10%% %i", (ids, standard, prepaid, floor, partialExtra) => {
    const items = (ids as string[]).map(id => one(id));
    expect(q(items, "COD").total).toBe(standard);
    expect(q(items, "Prepaid").total).toBe(prepaid);
    expect(q(items, "Prepaid", true).total).toBe(floor);
    expect(q(items, "Partial", true).total).toBe(partialExtra);
  });

  it("never releases the extra 10% on cash on delivery", () => {
    const result = q([one("serum"), one("sunscreen")], "COD", true);
    expect(result).toMatchObject({ extraAllowed: false, extraOff: 0, total: 909 });
  });
});

describe("the Anti-Pigmentation Kit", () => {
  it("is ₹1,499 on COD and partial, ₹1,449 prepaid", () => {
    expect(q([one("pigmentation-kit")], "COD")).toMatchObject({ total: 1499, mrpTotal: 2299, discount: 800, label: "Kit" });
    expect(q([one("pigmentation-kit")], "Partial").total).toBe(1499);
    expect(q([one("pigmentation-kit")], "Prepaid").total).toBe(1449);
  });

  it("drops to ₹1,304 prepaid or ₹1,349 partial with the extra 10%, and never below ₹1,300", () => {
    expect(q([one("pigmentation-kit")], "Prepaid", true).total).toBe(1304);
    expect(q([one("pigmentation-kit")], "Partial", true).total).toBe(1349);
    const steep = quote({ catalogue: DEFAULT_CATALOGUE, rules: { ...DEFAULT_RULES, extraPct: 30 }, items: [one("pigmentation-kit")], paymentMode: "Prepaid", extra: true });
    expect(steep.total).toBe(1300);
    expect(steep.warnings[0]).toMatch(/below ₹1,300/);
  });
});

describe("the Testing Kit", () => {
  it("is ₹399 flat, ₹349 prepaid, with no extra discount ever", () => {
    expect(q([one("testing-kit")], "COD").total).toBe(399);
    expect(q([one("testing-kit")], "Prepaid").total).toBe(349);
    expect(q([one("testing-kit")], "Prepaid", true)).toMatchObject({ extraAllowed: false, total: 349 });
  });
});

describe("the free bag and the order as a whole", () => {
  it("adds a free bag at no charge", () => {
    const result = q([one("pigmentation-kit")], "Prepaid", true, true);
    expect(result.lines.at(-1)).toMatchObject({ catalogueId: "free-bag", mrp: 0, quantity: 1 });
    expect(result.total).toBe(1304);
  });

  it("takes the ₹50 prepaid once per order, not per item", () => {
    expect(q([one("pigmentation-kit"), one("testing-kit")], "Prepaid").total).toBe(1499 + 399 - 50);
  });

  it("ignores items that are not in the catalogue or switched off", () => {
    const catalogue = DEFAULT_CATALOGUE.map(item => item.id === "serum" ? { ...item, active: false } : item);
    expect(quote({ catalogue, rules: DEFAULT_RULES, items: [one("serum"), one("nonsense")], paymentMode: "COD" }).lines).toHaveLength(0);
  });

  it("prices the same order in every mode for reading out", () => {
    const all = quoteByMode({ catalogue: DEFAULT_CATALOGUE, rules: DEFAULT_RULES, items: [one("pigmentation-kit")] });
    expect([all.COD.total, all.Prepaid.total, all.Partial.total]).toEqual([1499, 1449, 1499]);
  });
});
