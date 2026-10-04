import { describe, expect, it } from "vitest";
import { DEFAULT_CATALOGUE } from "./pricing";
import { DEFAULT_PACKAGING, deadWeightKg, declaredWeightKg, packagingOf, parcelFor, unitsIn, volumetricWeightKg } from "./packaging";

describe("packaging", () => {
  const rules = DEFAULT_PACKAGING;

  it("weighs the carton as Shiprocket does", () => {
    // 19 × 11 × 7 = 1463 cm³ ÷ 5000 = 0.2926 kg, rounded up to the next 10 g.
    expect(volumetricWeightKg(rules)).toBe(0.3);
    expect(deadWeightKg(1, rules)).toBe(0.15);
    expect(deadWeightKg(4, rules)).toBe(0.45);
  });

  it("declares the higher of dead and volumetric weight by default", () => {
    expect(declaredWeightKg(1, rules)).toBe(0.3);
    expect(declaredWeightKg(2, rules)).toBe(0.3);
    expect(declaredWeightKg(3, rules)).toBe(0.35);
    expect(declaredWeightKg(1, { ...rules, basis: "dead" })).toBe(0.15);
  });

  it("counts a Kit as all four products and the bag as nothing", () => {
    const items = [{ catalogueId: "pigmentation-kit", quantity: 1 }, { catalogueId: "serum", quantity: 2 }, { catalogueId: "free-bag", quantity: 1 }];
    expect(unitsIn(items, DEFAULT_CATALOGUE, rules)).toBe(6);
    expect(parcelFor(6, rules)).toEqual({ weight: 0.65, length: 19, breadth: 11, height: 7 });
  });

  it("fills missing settings from the defaults", () => {
    expect(packagingOf(null)).toEqual(DEFAULT_PACKAGING);
    expect(packagingOf({ unitGrams: 120, basis: "nonsense" as never }).basis).toBe("applicable");
  });
});
