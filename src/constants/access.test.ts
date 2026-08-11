import { describe, expect, it } from "vitest";
import { can, homeFor, usesAdminPanel, usesFieldPanel } from "./access";

describe("access", () => {
  it("sends desk roles to the admin panel and field roles to the mobile panel", () => {
    expect(homeFor("ADMIN")).toBe("/admin");
    expect(homeFor("HR")).toBe("/admin");
    expect(homeFor("MR")).toBe("/employee");
    expect(homeFor("SALES")).toBe("/employee");
    expect(usesAdminPanel("MR")).toBe(false);
    expect(usesFieldPanel("HR")).toBe(false);
  });

  it("lets field staff correct a doctor's call timing but not manage the directory", () => {
    expect(can.updateCallTime("SALES")).toBe(true);
    expect(can.updateCallTime("MR")).toBe(true);
    expect(can.manageDoctors("SALES")).toBe(false);
  });

  it("keeps route planning and reporting with the administrator", () => {
    expect(can.planRoutes("ADMIN")).toBe(true);
    expect(can.planRoutes("MR")).toBe(false);
    expect(can.viewAllReports("HR")).toBe(false);
  });

  it("only lets field roles log visits", () => {
    expect(can.logVisits("MR")).toBe(true);
    expect(can.logVisits("ADMIN")).toBe(false);
  });

  it("keeps raising a bill with the administrator, and lets HR watch the money", () => {
    expect(can.manageBilling("ADMIN")).toBe(true);
    expect(can.manageBilling("HR")).toBe(false);
    expect(can.manageBilling("MR")).toBe(false);
    expect(can.viewAllBilling("HR")).toBe(true);
    expect(can.viewAllBilling("MR")).toBe(false);
  });

  it("lets the rep in the clinic record what the doctor paid", () => {
    expect(can.recordPayment("MR")).toBe(true);
    expect(can.recordPayment("SALES")).toBe(true);
    expect(can.recordPayment("ADMIN")).toBe(true);
    // Ownership of the bill is checked on the server; HR has no collection role.
    expect(can.recordPayment("HR")).toBe(false);
  });

  it("separates preparing payroll from releasing it", () => {
    // The HR desk builds the month; only the administrator approves and pays.
    // One person able to do both is the oldest hole in any set of books.
    expect(can.runPayroll("HR")).toBe(true);
    expect(can.approvePayroll("HR")).toBe(false);
    expect(can.approvePayroll("ADMIN")).toBe(true);
  });

  it("keeps everybody else's salary away from the field", () => {
    expect(can.viewPayroll("MR")).toBe(false);
    expect(can.viewPayroll("SALES")).toBe(false);
    expect(can.runPayroll("MR")).toBe(false);
    // Reading their own payslip is not this permission; it is checked by owner.
    expect(can.viewPayroll("HR")).toBe(true);
  });

  it("separates preparing an affiliate payout from releasing it, as payroll does", () => {
    expect(can.runSalesPayout("HR")).toBe(true);
    expect(can.approveSalesPayout("HR")).toBe(false);
    expect(can.approveSalesPayout("ADMIN")).toBe(true);
  });

  it("keeps coupons and delivery corrections with the administrator", () => {
    // Issuing a coupon directs commission at a person, and correcting a
    // delivery decides whether an order pays at all.
    expect(can.manageSales("ADMIN")).toBe(true);
    expect(can.manageSales("HR")).toBe(false);
    expect(can.viewSales("HR")).toBe(true);
  });

  it("keeps the affiliate operation away from the field panel entirely", () => {
    for (const role of ["MR", "SALES"] as const) {
      expect(can.viewSales(role)).toBe(false);
      expect(can.manageSales(role)).toBe(false);
      expect(can.runSalesPayout(role)).toBe(false);
      expect(can.approveSalesPayout(role)).toBe(false);
    }
  });

  it("keeps the warehouse count with the administrator", () => {
    expect(can.manageInventory("ADMIN")).toBe(true);
    expect(can.manageInventory("HR")).toBe(false);
    expect(can.viewAllStock("HR")).toBe(true);
    expect(can.manageInventory("MR")).toBe(false);
  });
});
