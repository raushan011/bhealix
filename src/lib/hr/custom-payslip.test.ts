import { describe, expect, it } from "vitest";
import {
  blankCustomPayslip, customPayslipSchema, customToSheet, customTotals, detailsFromEmployee,
  type CustomPayslipDoc
} from "./custom-payslip";

const doc = (patch: Partial<CustomPayslipDoc> = {}): CustomPayslipDoc => ({
  ...blankCustomPayslip({ company: { tradeName: "BHEALIX", address: "Noida", pan: "ABCDE1234F" }, signatoryName: "R. Upadhyay" }),
  earnings: [{ name: "Basic", amount: 20_000 }, { name: "Arrears", amount: 3_500.4 }],
  deductions: [{ name: "TDS", amount: 1_200 }],
  ...patch
});

describe("totals", () => {
  it("adds the columns in whole rupees and nets them", () => {
    const totals = customTotals(doc());
    expect(totals.gross).toBe(23_500);
    expect(totals.totalDeductions).toBe(1_200);
    expect(totals.netPayable).toBe(22_300);
    expect(totals.netPay).toBe(22_300);
  });

  it("applies rounding only when the net is worked out", () => {
    expect(customTotals(doc({ roundOff: -300 })).netPay).toBe(22_000);
    const manual = customTotals(doc({ netPayMode: "manual", netPayOverride: 25_000, roundOff: -300 }));
    expect(manual.netPay).toBe(25_000);
    expect(manual.roundOff).toBe(0);
    // The arithmetic is still there for the sheet to explain the override against.
    expect(manual.netPayable).toBe(22_300);
  });
});

describe("the blank sheet", () => {
  it("does not repeat a city or PIN the street line already carries", () => {
    const blank = blankCustomPayslip({ company: { address: "C 171, Swarn Nagri, Greater Noida - 201310", city: "Greater Noida", state: "Uttar Pradesh", pinCode: "201310" } });
    expect(blank.company.address).toBe("C 171, Swarn Nagri, Greater Noida - 201310, Uttar Pradesh");
  });

  it("carries the company and signatory so the editor opens on this company's payslip", () => {
    const blank = blankCustomPayslip({ company: { tradeName: "BHEALIX", legalName: "Sarthak", city: "Noida", pan: "P" }, signatoryName: "S", month: "2026-07" });
    expect(blank.company).toEqual({ name: "BHEALIX", address: "Noida", pan: "P" });
    expect(blank.signatoryName).toBe("S");
    expect(blank.periodLabel).toBe("July 2026");
    expect(blank.status).toBe("Draft");
  });

  it("is accepted by the API's own validation as it stands", () => {
    expect(() => customPayslipSchema.parse(blankCustomPayslip({ month: "2026-07" }))).not.toThrow();
  });
});

describe("the sheet mapping", () => {
  it("prints as approved unless the draft mark is asked for, and drops empty detail lines", () => {
    const sheet = customToSheet(doc({ details: [{ label: "Name", value: "A" }, { label: "", value: "" }] }));
    expect(sheet.payslip.status).toBe("Approved");
    expect(sheet.custom.details).toEqual([{ label: "Name", value: "A" }]);
    expect(customToSheet(doc({ showDraftMark: true })).payslip.status).toBe("Draft");
  });

  it("carries the title, period, watermark and footer through unchanged", () => {
    const sheet = customToSheet(doc({ title: "Full and final settlement", periodLabel: "Up to 14 Aug 2026", watermark: "Copy", footerText: "Issued on request." }));
    expect(sheet.custom).toMatchObject({ title: "Full and final settlement", periodLabel: "Up to 14 Aug 2026", watermark: "Copy", footerText: "Issued on request." });
    expect(sheet.company.tradeName).toBe("BHEALIX");
    expect(sheet.meta.signatoryName).toBe("R. Upadhyay");
  });
});

describe("prefilling from an employee", () => {
  it("shows only the last four digits of the account and keeps blanks for the administrator to fill", () => {
    const lines = detailsFromEmployee({ name: "Asha", employeeId: "E1", bankAccountNo: "50200108611266", exitDate: "2026-08-14" });
    expect(lines.find(line => line.label === "Account")?.value).toBe("•••• 1266");
    expect(lines.some(line => line.label === "Last working day")).toBe(true);
    expect(lines.find(line => line.label === "PAN")?.value).toBe("");
  });
});
