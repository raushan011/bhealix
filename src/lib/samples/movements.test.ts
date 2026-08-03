import { describe, expect, it } from "vitest";
import { dispenseRowsFor, foldStock, signedQuantity, utilisation, type MovementType } from "./movements";

const visit = (overrides: Partial<Parameters<typeof dispenseRowsFor>[0]> = {}) => ({
  _id: "visit-1",
  employee: "rep-1",
  doctor: "doctor-1",
  status: "Completed",
  checkOutAt: new Date("2026-03-04T11:00:00Z"),
  samples: [{ product: "Serum", quantity: 3 }],
  ...overrides
});

const entry = (productName: string, type: MovementType, quantity: number) =>
  ({ productName, type, quantity: signedQuantity(type, quantity) });

describe("signedQuantity", () => {
  it("adds stock on issue and takes it away on dispense and return", () => {
    expect(signedQuantity("ISSUE", 10)).toBe(10);
    expect(signedQuantity("DISPENSE", 4)).toBe(-4);
    expect(signedQuantity("RETURN", 2)).toBe(-2);
  });

  it("ignores a stray sign on the three directional types", () => {
    expect(signedQuantity("ISSUE", -10)).toBe(10);
    expect(signedQuantity("DISPENSE", -4)).toBe(-4);
  });

  it("keeps the direction an adjustment was written with", () => {
    expect(signedQuantity("ADJUSTMENT", -6)).toBe(-6);
    expect(signedQuantity("ADJUSTMENT", 6)).toBe(6);
  });
});

describe("dispenseRowsFor", () => {
  it("turns each logged sample into a negative ledger row against the doctor", () => {
    const rows = dispenseRowsFor(visit({ samples: [{ product: "Serum", quantity: 3 }, { product: "Cleanser", quantity: 1 }] }));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ productName: "Serum", quantity: -3, doctor: "doctor-1", visit: "visit-1", employee: "rep-1" });
    expect(rows[1]).toMatchObject({ productName: "Cleanser", quantity: -1 });
  });

  it("produces nothing for a visit that was not completed, which is what returns the stock", () => {
    expect(dispenseRowsFor(visit({ status: "Missed" }))).toEqual([]);
    expect(dispenseRowsFor(visit({ status: "Planned" }))).toEqual([]);
  });

  it("skips blank and zero lines rather than writing meaningless rows", () => {
    const rows = dispenseRowsFor(visit({
      samples: [{ product: "", quantity: 2 }, { product: "Serum", quantity: 0 }, { product: "Toner", quantity: 1 }]
    }));
    expect(rows.map(row => row.productName)).toEqual(["Toner"]);
  });

  it("attaches the catalogue id when the product is still listed", () => {
    const rows = dispenseRowsFor(visit(), new Map([["Serum", "product-1"]]));
    expect(rows[0].product).toBe("product-1");
  });

  it("still records the hand-over when the product has left the catalogue", () => {
    const rows = dispenseRowsFor(visit(), new Map());
    expect(rows[0].product).toBeUndefined();
    expect(rows[0].productName).toBe("Serum");
  });

  it("dates the movement by check-out, falling back to the planned date", () => {
    expect(dispenseRowsFor(visit())[0].occurredAt).toEqual(new Date("2026-03-04T11:00:00Z"));
    const planned = dispenseRowsFor(visit({ checkOutAt: null, plannedDate: new Date("2026-03-01T00:00:00Z") }));
    expect(planned[0].occurredAt).toEqual(new Date("2026-03-01T00:00:00Z"));
  });
});

describe("foldStock", () => {
  it("balances a rep's stock across all four movement types", () => {
    const rows = foldStock([
      entry("Serum", "ISSUE", 50),
      entry("Serum", "DISPENSE", 12),
      entry("Serum", "DISPENSE", 8),
      entry("Serum", "RETURN", 5),
      entry("Serum", "ADJUSTMENT", -3)
    ]);
    expect(rows).toEqual([{ product: "Serum", issued: 50, dispensed: 20, returned: 5, adjusted: -3, balance: 22 }]);
  });

  it("goes negative when more was handed out than was ever issued", () => {
    const rows = foldStock([entry("Serum", "ISSUE", 5), entry("Serum", "DISPENSE", 8)]);
    expect(rows[0].balance).toBe(-3);
  });

  it("keeps products apart and returns them in a stable order", () => {
    const rows = foldStock([
      entry("Toner", "ISSUE", 4),
      entry("Cleanser", "ISSUE", 9),
      entry("Cleanser", "DISPENSE", 2)
    ]);
    expect(rows.map(row => row.product)).toEqual(["Cleanser", "Toner"]);
    expect(rows.map(row => row.balance)).toEqual([7, 4]);
  });
});

describe("utilisation", () => {
  it("reports the share of issued stock that reached a doctor", () => {
    expect(utilisation(50, 20)).toBe(40);
  });

  it("is zero rather than NaN before anything is issued", () => {
    expect(utilisation(0, 0)).toBe(0);
  });
});
