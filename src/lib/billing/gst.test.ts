import { describe, expect, it } from "vitest";
import {
  amountInWords, balanceOf, computeInvoice, computeLine, isOverdue, money, statusFor
} from "./gst";
import { dueDateFrom, financialYear, formatInvoiceNo } from "./numbering";
import { isGstin, stateCodeOfGstin } from "./constants";

const line = (overrides: Partial<Parameters<typeof computeLine>[0]> = {}) => ({
  name: "Serum",
  quantity: 10,
  rate: 100,
  discountType: "PERCENT" as const,
  discountValue: 0,
  gstRate: 18,
  ...overrides
});

const INTRA = { taxed: true, interState: false, ratesIncludeTax: false };
const INTER = { taxed: true, interState: true, ratesIncludeTax: false };

describe("money", () => {
  it("rounds a half paisa up rather than losing it to binary floating point", () => {
    expect(money(1.005)).toBe(1.01);
    expect(money(2.675)).toBe(2.68);
  });

  it("keeps the sign of a negative round-off", () => {
    expect(money(-0.455)).toBe(-0.46);
  });
});

describe("computeLine", () => {
  it("splits the tax in half within the state", () => {
    expect(computeLine(line(), INTRA)).toMatchObject({
      gross: 1000, discount: 0, taxableValue: 1000, cgst: 90, sgst: 90, igst: 0, total: 1180
    });
  });

  it("charges one IGST across state lines", () => {
    expect(computeLine(line(), INTER)).toMatchObject({ cgst: 0, sgst: 0, igst: 180, total: 1180 });
  });

  it("takes a percentage discount off before tax, not after", () => {
    const result = computeLine(line({ discountValue: 10 }), INTRA);
    expect(result.discount).toBe(100);
    expect(result.taxableValue).toBe(900);
    expect(result.taxAmount).toBe(162);
    expect(result.total).toBe(1062);
  });

  it("takes a flat discount off the line total", () => {
    const result = computeLine(line({ discountType: "AMOUNT", discountValue: 250 }), INTRA);
    expect(result.taxableValue).toBe(750);
    expect(result.total).toBe(885);
  });

  it("will not let a discount exceed the line and turn it into a credit", () => {
    const result = computeLine(line({ discountType: "AMOUNT", discountValue: 5000 }), INTRA);
    expect(result.discount).toBe(1000);
    expect(result.taxableValue).toBe(0);
    expect(result.total).toBe(0);
  });

  it("caps a percentage discount at the whole line", () => {
    expect(computeLine(line({ discountValue: 150 }), INTRA).discount).toBe(1000);
  });

  it("backs the tax out of a rate that already includes it", () => {
    const result = computeLine(line({ rate: 118 }), { ...INTRA, ratesIncludeTax: true });
    expect(result.taxableValue).toBe(1000);
    expect(result.taxAmount).toBe(180);
    // The doctor pays exactly what was quoted.
    expect(result.total).toBe(1180);
  });

  it("charges nothing on a bill of supply however the product is rated", () => {
    const result = computeLine(line(), { taxed: false, interState: false, ratesIncludeTax: false });
    expect(result.taxAmount).toBe(0);
    expect(result.total).toBe(1000);
  });

  it("keeps the two halves adding back to the tax on an odd amount", () => {
    const result = computeLine(line({ quantity: 1, rate: 99.99, gstRate: 5 }), INTRA);
    expect(money(result.cgst + result.sgst)).toBe(result.taxAmount);
  });
});

describe("computeInvoice", () => {
  const lines = [
    line({ name: "Serum", hsnCode: "3304", quantity: 10, rate: 100, discountValue: 10 }),
    line({ name: "Cleanser", hsnCode: "3401", quantity: 5, rate: 200, gstRate: 12 })
  ];

  it("totals the lines and rounds the payable amount to whole rupees", () => {
    const { totals } = computeInvoice(lines, INTRA);
    expect(totals.subtotal).toBe(2000);
    expect(totals.totalDiscount).toBe(100);
    expect(totals.taxableValue).toBe(1900);
    expect(totals.cgstTotal).toBe(141);      // 81 on the serum, 60 on the cleanser
    expect(totals.sgstTotal).toBe(141);
    expect(totals.taxTotal).toBe(282);
    expect(totals.grandTotal).toBe(2182);
    expect(totals.roundOff).toBe(0);
  });

  it("states the round-off it applied", () => {
    const { totals } = computeInvoice([line({ quantity: 1, rate: 99.4, gstRate: 0 })], INTRA);
    expect(totals.netTotal).toBe(99.4);
    expect(totals.grandTotal).toBe(99);
    expect(totals.roundOff).toBe(-0.4);
  });

  it("summarises tax by HSN and rate for the foot of the invoice", () => {
    const { totals } = computeInvoice(lines, INTRA);
    expect(totals.taxSummary).toEqual([
      { hsnCode: "3401", gstRate: 12, taxableValue: 1000, cgst: 60, sgst: 60, igst: 0 },
      { hsnCode: "3304", gstRate: 18, taxableValue: 900, cgst: 81, sgst: 81, igst: 0 }
    ]);
  });

  it("merges lines that share an HSN and a rate", () => {
    const { totals } = computeInvoice([
      line({ hsnCode: "3304", quantity: 1, rate: 100 }),
      line({ hsnCode: "3304", quantity: 2, rate: 100 })
    ], INTRA);
    expect(totals.taxSummary).toHaveLength(1);
    expect(totals.taxSummary[0].taxableValue).toBe(300);
  });

  it("reports zeroes rather than NaN for an invoice with no lines yet", () => {
    const { totals } = computeInvoice([], INTRA);
    expect(totals).toMatchObject({ subtotal: 0, taxableValue: 0, taxTotal: 0, grandTotal: 0 });
  });
});

describe("balanceOf and statusFor", () => {
  it("owes the whole amount before anything is paid", () => {
    expect(balanceOf(2182, [])).toBe(2182);
    expect(statusFor(2182, 0, false)).toBe("Unpaid");
  });

  it("adds part payments up", () => {
    expect(balanceOf(2182, [{ amount: 1000 }, { amount: 182.5 }])).toBe(999.5);
    expect(statusFor(2182, 1182.5, false)).toBe("Partially paid");
  });

  it("is paid once the payments meet the total", () => {
    expect(balanceOf(2182, [{ amount: 2182 }])).toBe(0);
    expect(statusFor(2182, 2182, false)).toBe("Paid");
  });

  it("does not leave an invoice unpaid over a rounding crumb", () => {
    expect(statusFor(100, 99.999, false)).toBe("Paid");
  });

  it("stays cancelled whatever was paid against it", () => {
    expect(statusFor(2182, 2182, true)).toBe("Cancelled");
    expect(statusFor(2182, 0, true)).toBe("Cancelled");
  });
});

describe("isOverdue", () => {
  const now = new Date("2026-04-10T09:00:00");

  it("is overdue once the whole due day has passed", () => {
    expect(isOverdue({ status: "Unpaid", dueDate: "2026-04-09" }, now)).toBe(true);
  });

  it("is not overdue on the due date itself", () => {
    expect(isOverdue({ status: "Unpaid", dueDate: "2026-04-10" }, now)).toBe(false);
  });

  it("ignores invoices that owe nothing", () => {
    expect(isOverdue({ status: "Paid", dueDate: "2026-01-01" }, now)).toBe(false);
    expect(isOverdue({ status: "Cancelled", dueDate: "2026-01-01" }, now)).toBe(false);
  });

  it("cannot be overdue without a due date", () => {
    expect(isOverdue({ status: "Unpaid" }, now)).toBe(false);
  });
});

describe("amountInWords", () => {
  it("writes rupees in the Indian grouping", () => {
    expect(amountInWords(2182)).toBe("Rupees Two Thousand One Hundred Eighty Two Only");
    expect(amountInWords(125000)).toBe("Rupees One Lakh Twenty Five Thousand Only");
    expect(amountInWords(10000000)).toBe("Rupees One Crore Only");
  });

  it("spells the paise out separately", () => {
    expect(amountInWords(1180.5)).toBe("Rupees One Thousand One Hundred Eighty and Fifty Paise Only");
  });

  it("has words for nothing at all", () => {
    expect(amountInWords(0)).toBe("Rupees Zero Only");
  });
});

describe("numbering", () => {
  it("puts January to March in the financial year that began the previous April", () => {
    expect(financialYear(new Date(2026, 0, 15))).toBe("2025-26");
    expect(financialYear(new Date(2026, 3, 1))).toBe("2026-27");
    expect(financialYear(new Date(2026, 2, 31))).toBe("2025-26");
  });

  it("formats a number that sorts and reads correctly", () => {
    expect(formatInvoiceNo("BHX", "2025-26", 7)).toBe("BHX/2025-26/0007");
  });

  it("falls back to the default series rather than emitting a broken number", () => {
    expect(formatInvoiceNo("  ", "2025-26", 1)).toBe("BHX/2025-26/0001");
    expect(formatInvoiceNo("bhx/skin", "2025-26", 1)).toBe("BHXSKIN/2025-26/0001");
  });

  it("adds the credit period to the invoice date, crossing the month end", () => {
    expect(dueDateFrom("2026-01-25", 15)).toBe("2026-02-09");
    expect(dueDateFrom("2026-01-25", 0)).toBe("2026-01-25");
  });
});

describe("gstin", () => {
  it("accepts a well-formed number and reads the state off the front", () => {
    expect(isGstin("27AAPFU0939F1ZV")).toBe(true);
    expect(stateCodeOfGstin("27AAPFU0939F1ZV")).toBe("27");
  });

  it("rejects anything the wrong shape", () => {
    expect(isGstin("27AAPFU0939F1Z")).toBe(false);
    expect(isGstin("")).toBe(false);
    expect(stateCodeOfGstin("nonsense")).toBe("");
  });
});
