import { describe, expect, it } from "vitest";
import { buildStatement, fromPaise, sumRupees } from "./statement";

describe("buildStatement", () => {
  const sheet = () => buildStatement({
    vendor: "Razorpay — gateway fees",
    period: "2026-08",
    columns: ["Payment ID", "Fee"],
    rows: [["pay_1", 23.6], ["pay_2", 47.2]],
    totals: { amount: 70.8, taxAmount: 10.8 }
  }).toString("utf8");

  it("says what it is, and says what it is not", () => {
    /*
     * The line that matters most in the whole file. These sheets leave the
     * application as email attachments and end up in an accountant's folder
     * beside real tax invoices, so one that did not disclaim itself would
     * eventually be claimed against.
     */
    expect(sheet()).toContain("NOT a tax invoice");
    expect(sheet()).toContain("Razorpay — gateway fees");
    expect(sheet()).toContain("August 2026");
  });

  it("leads with a BOM so Excel reads it as UTF-8", () => {
    expect(sheet().startsWith("﻿")).toBe(true);
  });

  it("carries the rows and totals the accountant will check", () => {
    expect(sheet()).toContain("pay_1,23.6");
    expect(sheet()).toContain("Total charged,70.8");
    expect(sheet()).toContain("Of which tax,10.8");
    expect(sheet()).toContain("Rows,2");
  });

  it("quotes a field with a comma so the columns hold", () => {
    const csv = buildStatement({
      vendor: "Meta", period: "2026-08", columns: ["Note"],
      rows: [['Spend, all campaigns']], totals: {}
    }).toString("utf8");
    expect(csv).toContain('"Spend, all campaigns"');
  });

  it("leaves a total blank rather than writing a zero it does not know", () => {
    // Meta's insights report no tax at all. A zero there would be a figure
    // somebody could claim credit against; blank is the truth.
    const csv = buildStatement({ vendor: "Meta", period: "2026-08", columns: ["Date"], rows: [], totals: { amount: 400 } })
      .toString("utf8");
    expect(csv).toContain("Total charged,400");
    expect(csv).toContain("Of which tax,\r\n");
  });
});

describe("fromPaise", () => {
  it("turns what a payment API returns into what an accountant writes", () => {
    expect(fromPaise(2360)).toBe(23.6);
    expect(fromPaise("2360")).toBe(23.6);
  });

  it("treats a missing fee as nothing rather than as NaN", () => {
    // An authorised-but-not-captured payment comes back with `fee: null`, and a
    // NaN in one row would poison the whole column's total.
    expect(fromPaise(null)).toBe(0);
    expect(fromPaise(undefined)).toBe(0);
    expect(fromPaise("not a number")).toBe(0);
  });
});

describe("sumRupees", () => {
  it("adds money without floating point drift", () => {
    // 0.1 + 0.2 is famously not 0.3, and a fee column is hundreds of such
    // values — a statement whose total does not equal its own rows is worse
    // than no statement.
    expect(sumRupees([0.1, 0.2])).toBe(0.3);
    expect(sumRupees([23.6, 47.2, 11.8])).toBe(82.6);
    expect(sumRupees(Array.from({ length: 100 }, () => 2.36))).toBe(236);
  });

  it("is zero for nothing", () => {
    expect(sumRupees([])).toBe(0);
  });
});
