import { describe, expect, it } from "vitest";
import { foldLevels, levelChange, signedStock, stockAlert, type StockMovementType } from "./movements";

const entry = (productName: string, type: StockMovementType, quantity: number) =>
  ({ productName, type, quantity: signedStock(type, quantity) });

describe("signedStock", () => {
  it("adds what comes in and takes away what goes out", () => {
    expect(signedStock("PURCHASE", 100)).toBe(100);
    expect(signedStock("OPENING", 40)).toBe(40);
    expect(signedStock("SALE", 12)).toBe(-12);
    expect(signedStock("SAMPLE_ISSUE", 5)).toBe(-5);
    expect(signedStock("SALE_RETURN", 3)).toBe(3);
    expect(signedStock("SAMPLE_RETURN", 2)).toBe(2);
  });

  it("ignores a stray sign on the directional types", () => {
    expect(signedStock("SALE", -12)).toBe(-12);
    expect(signedStock("PURCHASE", -100)).toBe(100);
  });

  it("keeps the direction an adjustment was written with", () => {
    expect(signedStock("ADJUSTMENT", -7)).toBe(-7);
    expect(signedStock("ADJUSTMENT", 7)).toBe(7);
  });
});

describe("foldLevels", () => {
  it("balances a product across every way stock moves", () => {
    const levels = foldLevels([
      entry("Serum", "OPENING", 20),
      entry("Serum", "PURCHASE", 100),
      entry("Serum", "SALE", 30),
      entry("Serum", "SALE_RETURN", 5),
      entry("Serum", "SAMPLE_ISSUE", 10),
      entry("Serum", "ADJUSTMENT", -2)
    ]);
    expect(levels).toEqual([
      { product: "Serum", received: 120, sold: 30, sampled: 10, returned: 5, adjusted: -2, balance: 83 }
    ]);
  });

  it("goes negative when more was billed than was ever received", () => {
    expect(foldLevels([entry("Toner", "PURCHASE", 5), entry("Toner", "SALE", 8)])[0].balance).toBe(-3);
  });

  it("keeps products apart and returns them in a stable order", () => {
    const levels = foldLevels([entry("Toner", "PURCHASE", 4), entry("Cleanser", "PURCHASE", 9)]);
    expect(levels.map(level => level.product)).toEqual(["Cleanser", "Toner"]);
  });
});

describe("levelChange", () => {
  it("opens the ledger with the first count a product is given", () => {
    expect(levelChange(0, 100, false)).toEqual({ type: "OPENING", quantity: 100 });
  });

  it("records a later correction as an adjustment, in either direction", () => {
    expect(levelChange(80, 100, true)).toEqual({ type: "ADJUSTMENT", quantity: 20 });
    expect(levelChange(80, 60, true)).toEqual({ type: "ADJUSTMENT", quantity: -20 });
  });

  it("writes nothing when the count has not moved", () => {
    expect(levelChange(80, 80, true)).toBeNull();
    expect(levelChange(0, 0, false)).toBeNull();
  });

  it("corrects a negative balance back up to the counted figure", () => {
    // More was billed than was ever received; counting 10 on the shelf has to
    // add 13, not 10, or the ledger would still read short.
    expect(levelChange(-3, 10, true)).toEqual({ type: "ADJUSTMENT", quantity: 13 });
  });

  it("ignores a fractional or negative target — units are whole things", () => {
    expect(levelChange(0, 12.7, false)).toEqual({ type: "OPENING", quantity: 12 });
    expect(levelChange(5, -20, true)).toEqual({ type: "ADJUSTMENT", quantity: -5 });
  });
});

describe("stockAlert", () => {
  it("calls a product out of stock at zero or below", () => {
    expect(stockAlert(0, 10)).toBe("out");
    expect(stockAlert(-4, 0)).toBe("out");
  });

  it("warns once the balance reaches the reorder level", () => {
    expect(stockAlert(10, 10)).toBe("low");
    expect(stockAlert(9, 10)).toBe("low");
    expect(stockAlert(11, 10)).toBeNull();
  });

  it("stays quiet for a product with no reorder level set", () => {
    expect(stockAlert(3)).toBeNull();
  });
});
