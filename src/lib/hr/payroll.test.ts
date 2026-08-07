import { describe, expect, it } from "vitest";
import {
  computePayslip, DEFAULT_STATUTORY, EMPTY_COMPONENTS, ESI_WAGE_CEILING, fullGrossOf,
  monthBounds, monthLabel, onRollDates, PF_DEDUCTION_LABEL, PF_WAGE_CEILING, previousMonth,
  professionalTax, staleRules, type PayslipInput, type SalaryComponents
} from "./payroll";

const components = (patch: Partial<SalaryComponents> = {}): SalaryComponents =>
  ({ ...EMPTY_COMPONENTS, ...patch });

/** A full month worked, on a thirty-one day month, unless a test says otherwise. */
const input = (patch: Partial<PayslipInput> = {}): PayslipInput => ({
  components: components({ basic: 20_000, hra: 8_000, conveyance: 1_600, medical: 1_250, special: 4_150 }),
  statutory: { ...DEFAULT_STATUTORY },
  attendance: { divisorDays: 31, onRollDays: 31, lopDays: 0 },
  month: 8,
  ...patch
});

const amountOf = (rows: Array<{ name: string; amount: number }>, name: string) =>
  rows.find(row => row.name === name)?.amount ?? 0;

describe("a full month", () => {
  it("pays every head in full and deducts the fund on the ceiling", () => {
    const slip = computePayslip(input());

    expect(slip.fullGross).toBe(35_000);
    expect(slip.gross).toBe(35_000);
    expect(slip.paidDays).toBe(31);

    // Basic is above the ₹15,000 ceiling, so the fund is due on the ceiling.
    expect(slip.pfWages).toBe(PF_WAGE_CEILING);
    expect(amountOf(slip.deductions, "Provident fund")).toBe(1_800);
  });

  it("adds up: every earning line makes the gross, every deduction the total", () => {
    const slip = computePayslip(input({ attendance: { divisorDays: 30, onRollDays: 30, lopDays: 3.5 } }));

    expect(slip.earnings.reduce((sum, row) => sum + row.amount, 0)).toBe(slip.gross);
    expect(slip.deductions.reduce((sum, row) => sum + row.amount, 0)).toBe(slip.totalDeductions);
    expect(slip.netPayable).toBe(slip.gross - slip.totalDeductions);
  });

  it("never states a net the components cannot produce", () => {
    // The one thing an employee checks. Rounding each line and summing, rather
    // than rounding the total, is what keeps this true.
    for (const lop of [0, 0.5, 1, 7.5, 13]) {
      const slip = computePayslip(input({ attendance: { divisorDays: 31, onRollDays: 31, lopDays: lop } }));
      expect(slip.earnings.reduce((sum, row) => sum + row.amount, 0)).toBe(slip.gross);
    }
  });
});

describe("loss of pay", () => {
  it("takes the days off every head, not off the total", () => {
    const full = computePayslip(input());
    const lop = computePayslip(input({ attendance: { divisorDays: 31, onRollDays: 31, lopDays: 3 } }));

    expect(lop.paidDays).toBe(28);
    expect(lop.gross).toBeLessThan(full.gross);
    // 28/31 of a ₹20,000 basic.
    expect(amountOf(lop.earnings, "Basic")).toBe(Math.round(20_000 * 28 / 31));
  });

  it("counts half a day as half", () => {
    const slip = computePayslip(input({ attendance: { divisorDays: 30, onRollDays: 30, lopDays: 0.5 } }));
    expect(slip.paidDays).toBe(29.5);
  });

  it("reduces the fund with the basic, because the wages it is due on fell", () => {
    // A basic under the ceiling: the fund follows what was actually paid.
    const slip = computePayslip(input({
      components: components({ basic: 12_000, hra: 4_800, special: 3_200 }),
      attendance: { divisorDays: 30, onRollDays: 30, lopDays: 15 }
    }));
    expect(slip.pfWages).toBe(6_000);
    expect(amountOf(slip.deductions, "Provident fund")).toBe(720);
  });

  it("pays nothing for a month entirely lost, without going negative on the gross", () => {
    const slip = computePayslip(input({ attendance: { divisorDays: 31, onRollDays: 31, lopDays: 31 } }));
    expect(slip.paidDays).toBe(0);
    expect(slip.gross).toBe(0);
    expect(slip.netPay).toBeLessThanOrEqual(0);
  });

  it("cannot be talked into a negative day count", () => {
    const slip = computePayslip(input({ attendance: { divisorDays: 31, onRollDays: 31, lopDays: 40 } }));
    expect(slip.paidDays).toBe(0);
  });
});

describe("joiners and leavers", () => {
  it("pays a mid-month joiner for the days they were on the rolls", () => {
    // Joined on the 18th of a 31-day month: 14 days.
    const slip = computePayslip(input({ attendance: { divisorDays: 31, onRollDays: 14, lopDays: 0 } }));
    expect(slip.paidDays).toBe(14);
    expect(amountOf(slip.earnings, "Basic")).toBe(Math.round(20_000 * 14 / 31));
  });

  it("divides by the whole month, not by the days on the rolls", () => {
    // A joiner must not be paid a full month's salary over a part month — the
    // divisor is the month, which is what makes the pro-rating a pro-rating.
    const joiner = computePayslip(input({ attendance: { divisorDays: 31, onRollDays: 10, lopDays: 0 } }));
    const full = computePayslip(input());
    expect(joiner.gross).toBeLessThan(full.gross);
    expect(joiner.gross).toBe(Math.round(20_000 * 10 / 31) + Math.round(8_000 * 10 / 31)
      + Math.round(1_600 * 10 / 31) + Math.round(1_250 * 10 / 31) + Math.round(4_150 * 10 / 31));
  });

  it("counts the days somebody was on the rolls from the dates themselves", () => {
    const august = Array.from({ length: 31 }, (_, index) => `2026-08-${String(index + 1).padStart(2, "0")}`);

    expect(onRollDates(august, "2026-08-18").length).toBe(14);
    expect(onRollDates(august, null, "2026-08-09").length).toBe(9);
    expect(onRollDates(august, "2026-08-05", "2026-08-20").length).toBe(16);
    // Joined before the month and still here: the whole month.
    expect(onRollDates(august, "2024-01-01").length).toBe(31);
    // Left before the month began: nothing at all.
    expect(onRollDates(august, null, "2026-07-31").length).toBe(0);
  });
});

describe("provident fund", () => {
  it("caps at the statutory wage ceiling by default", () => {
    const slip = computePayslip(input({ components: components({ basic: 60_000 }) }));
    expect(slip.pfWages).toBe(PF_WAGE_CEILING);
    expect(amountOf(slip.deductions, "Provident fund")).toBe(1_800);
  });

  it("is calculated on the whole basic where the company has agreed to that", () => {
    const slip = computePayslip(input({
      components: components({ basic: 60_000 }),
      statutory: { ...DEFAULT_STATUTORY, pfOnFullBasic: true }
    }));
    expect(slip.pfWages).toBe(60_000);
    expect(amountOf(slip.deductions, "Provident fund")).toBe(7_200);
  });

  it("splits the employer's twelve per cent into pension and fund", () => {
    const slip = computePayslip(input());
    const pension = amountOf(slip.employerContributions, "Provident fund — pension share");
    const fund = amountOf(slip.employerContributions, "Provident fund — fund share");

    expect(pension).toBe(Math.round(15_000 * 0.0833));
    expect(pension + fund).toBe(Math.round(15_000 * 0.12));
  });

  it("is absent altogether for somebody outside the scheme", () => {
    const slip = computePayslip(input({ statutory: { ...DEFAULT_STATUTORY, pfApplicable: false } }));
    expect(slip.pfWages).toBe(0);
    expect(amountOf(slip.deductions, "Provident fund")).toBe(0);
    expect(amountOf(slip.employerContributions, "Provident fund — fund share")).toBe(0);
  });

  it("never deducts the employer's share from the employee", () => {
    const slip = computePayslip(input());
    const employerTotal = slip.employerContributions.reduce((sum, row) => sum + row.amount, 0);
    expect(slip.netPayable).toBe(slip.gross - slip.totalDeductions);
    expect(slip.costToCompany).toBe(slip.gross + employerTotal);
    expect(slip.costToCompany).toBeGreaterThan(slip.gross);
  });
});

describe("state insurance", () => {
  const low = components({ basic: 9_000, hra: 4_500, special: 4_500 });   // ₹18,000 gross

  it("covers a wage inside the ceiling, and rounds both shares up to the rupee", () => {
    const slip = computePayslip(input({ components: low }));
    expect(slip.esiWages).toBe(18_000);
    expect(amountOf(slip.deductions, "State insurance (ESI)")).toBe(Math.ceil(18_000 * 0.0075));
    expect(amountOf(slip.employerContributions, "State insurance (ESI)")).toBe(Math.ceil(18_000 * 0.0325));
  });

  it("leaves a wage above the ceiling out of the scheme", () => {
    const slip = computePayslip(input());   // ₹35,000
    expect(slip.esiWages).toBe(0);
    expect(amountOf(slip.deductions, "State insurance (ESI)")).toBe(0);
  });

  it("decides eligibility on the full wage, not on a month cut short by leave", () => {
    // ₹25,000 a month is outside the scheme. A fortnight of unpaid leave brings
    // the paid gross under ₹21,000, which must not sweep somebody into ESI.
    const above = components({ basic: 12_500, hra: 6_250, special: 6_250 });
    const slip = computePayslip(input({
      components: above,
      attendance: { divisorDays: 30, onRollDays: 30, lopDays: 15 }
    }));
    expect(slip.gross).toBeLessThan(ESI_WAGE_CEILING);
    expect(amountOf(slip.deductions, "State insurance (ESI)")).toBe(0);
  });

  it("charges the scheme on what was actually paid", () => {
    const slip = computePayslip(input({
      components: low,
      attendance: { divisorDays: 30, onRollDays: 30, lopDays: 10 }
    }));
    expect(slip.esiWages).toBe(slip.gross);
    expect(slip.esiWages).toBeLessThan(18_000);
  });
});

describe("professional tax", () => {
  it("reads the slab the wage falls in", () => {
    const slabs = [{ upTo: 10_000, amount: 0 }, { upTo: 15_000, amount: 110 }, { upTo: null, amount: 200 }];
    expect(professionalTax(9_000, slabs)).toBe(0);
    expect(professionalTax(10_000, slabs)).toBe(0);
    expect(professionalTax(12_000, slabs)).toBe(110);
    expect(professionalTax(80_000, slabs)).toBe(200);
  });

  it("reads an unsorted slab table the same way", () => {
    const jumbled = [{ upTo: null, amount: 200 }, { upTo: 15_000, amount: 110 }, { upTo: 10_000, amount: 0 }];
    expect(professionalTax(12_000, jumbled)).toBe(110);
    expect(professionalTax(9_000, jumbled)).toBe(0);
  });

  it("charges the February figure where a state meets its annual ceiling that way", () => {
    const slabs = [{ upTo: 10_000, amount: 0 }, { upTo: null, amount: 200 }];
    expect(professionalTax(30_000, slabs, 2, 300)).toBe(300);
    expect(professionalTax(30_000, slabs, 3, 300)).toBe(200);
    // Somebody below the threshold owes nothing in February either.
    expect(professionalTax(8_000, slabs, 2, 300)).toBe(0);
  });

  it("is nothing at all where a company is not liable", () => {
    expect(professionalTax(50_000, [])).toBe(0);
    const slip = computePayslip(input({
      statutory: { ...DEFAULT_STATUTORY, professionalTaxApplicable: false }
    }));
    expect(amountOf(slip.deductions, "Professional tax")).toBe(0);
  });
});

describe("recoveries and tax", () => {
  it("deducts a loan instalment in full, however short the month was", () => {
    const statutory = {
      ...DEFAULT_STATUTORY,
      recurringDeductions: [{ name: "Salary advance", amount: 2_000 }]
    };
    const full = computePayslip(input({ statutory }));
    const short = computePayslip(input({ statutory, attendance: { divisorDays: 31, onRollDays: 31, lopDays: 15 } }));

    expect(amountOf(full.deductions, "Salary advance")).toBe(2_000);
    // Half a month's work does not halve what was borrowed.
    expect(amountOf(short.deductions, "Salary advance")).toBe(2_000);
  });

  it("carries the declared monthly tax straight onto the slip", () => {
    const slip = computePayslip(input({ statutory: { ...DEFAULT_STATUTORY, monthlyTds: 3_400 } }));
    expect(amountOf(slip.deductions, "Income tax (TDS)")).toBe(3_400);
  });

  it("shows a net below zero rather than hiding a recovery that outran the pay", () => {
    // A heavy month of unpaid leave against a standing recovery. Quietly
    // clamping this to zero would leave the books saying the loan was repaid.
    const slip = computePayslip(input({
      statutory: { ...DEFAULT_STATUTORY, recurringDeductions: [{ name: "Salary advance", amount: 9_000 }] },
      attendance: { divisorDays: 30, onRollDays: 30, lopDays: 28 }
    }));
    expect(slip.netPay).toBeLessThan(0);
  });
});

describe("the month itself", () => {
  it("names a month the way a payslip has to", () => {
    expect(monthLabel("2026-08")).toBe("August 2026");
    expect(monthLabel("2026-01")).toBe("January 2026");
  });

  it("finds the first and last day, February and all", () => {
    expect(monthBounds("2026-08")).toEqual({ first: "2026-08-01", last: "2026-08-31" });
    expect(monthBounds("2026-02")).toEqual({ first: "2026-02-01", last: "2026-02-28" });
    // 2028 is a leap year.
    expect(monthBounds("2028-02").last).toBe("2028-02-29");
  });

  it("offers the month just gone, because payroll is run in arrears", () => {
    expect(previousMonth(new Date(2026, 7, 3))).toBe("2026-07");
    // Across a year boundary.
    expect(previousMonth(new Date(2026, 0, 3))).toBe("2025-12");
  });
});

describe("the salary on paper", () => {
  it("totals the fixed heads and the company's own allowances alike", () => {
    expect(fullGrossOf(components({
      basic: 20_000, hra: 8_000,
      otherAllowances: [{ name: "Field allowance", amount: 3_000 }, { name: "Mobile", amount: 500 }]
    }))).toBe(31_500);
  });

  it("survives a structure nobody has filled in yet", () => {
    const slip = computePayslip(input({ components: EMPTY_COMPONENTS }));
    expect(slip.gross).toBe(0);
    expect(slip.netPay).toBe(0);
    expect(slip.costToCompany).toBe(0);
  });
});

describe("a draft the rules have moved on from", () => {
  const settled = { lopBasis: "Calendar days", pfEnabled: false };
  const withPf = [{ deductions: [{ name: PF_DEDUCTION_LABEL, amount: 1_626 }, { name: "Professional tax", amount: 200 }] }];
  const withoutPf = [{ deductions: [{ name: "Professional tax", amount: 200 }] }];

  it("says nothing about a draft that still matches the rules in force", () => {
    expect(staleRules({ lopBasis: "Calendar days", pfEnabled: false }, withoutPf, settled)).toEqual([]);
  });

  /**
   * The case this exists for. A stored payslip is never recomputed, so a month
   * prepared while the fund was on goes on deducting it however plainly the
   * settings screen now says the company runs no fund.
   */
  it("catches a draft still deducting a fund the company has switched off", () => {
    expect(staleRules({ lopBasis: "Calendar days", pfEnabled: true }, withPf, settled))
      .toEqual(["the company no longer operates a provident fund"]);
  });

  /** A month prepared before the switch existed carries no flag to compare. */
  it("catches it from the payslips alone when the run predates the setting", () => {
    expect(staleRules({ lopBasis: "Calendar days" }, withPf, settled)).toHaveLength(1);
  });

  it("catches the fund being switched on after the month was prepared", () => {
    expect(staleRules({ lopBasis: "Calendar days", pfEnabled: false }, withoutPf,
      { lopBasis: "Calendar days", pfEnabled: true }))
      .toEqual(["the provident fund has since been switched on"]);
  });

  it("catches a changed day basis, and both changes at once", () => {
    expect(staleRules({ lopBasis: "Working days", pfEnabled: true }, withPf, settled)).toEqual([
      "a day is now counted as calendar days",
      "the company no longer operates a provident fund"
    ]);
  });
});
