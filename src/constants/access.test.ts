import { describe, expect, it } from "vitest";
import { ASSIGNABLE_ROLES, can, homeFor, mayEditAccount, usesAdminPanel, usesFieldPanel } from "./access";

describe("the super administrator cannot be created from inside the app", () => {
  it("is not on the list of roles the Employees screen may assign", () => {
    /*
     * The whole security model of this role. `ROLES` feeds a `z.enum` on two
     * team API routes and a `<select>` on two forms, all four reached by
     * `can.manageEmployees` — which is ADMIN *or HR*. On that list, any
     * administrator could mint the account that is meant to be above them.
     */
    expect(ASSIGNABLE_ROLES).not.toContain("SUPERADMIN");
    expect(ASSIGNABLE_ROLES).toEqual(["ADMIN", "HR", "MR", "SALES"]);
  });

  it("closes a super administrator's whole record to everybody below them", () => {
    // Not only their role: this route also sets passwords and `active`. An
    // administrator who could set that password could sign in as them, and one
    // who could deactivate them could remove the only account able to restore
    // anybody's access — with no way back through the interface.
    expect(mayEditAccount("ADMIN", "SUPERADMIN")).toBe(false);
    expect(mayEditAccount("HR", "SUPERADMIN")).toBe(false);
    expect(mayEditAccount("SUPERADMIN", "SUPERADMIN")).toBe(true);
  });

  it("leaves every other account editable exactly as before", () => {
    for (const target of ["ADMIN", "HR", "MR", "SALES"] as const) {
      expect(mayEditAccount("ADMIN", target)).toBe(true);
      expect(mayEditAccount("HR", target)).toBe(true);
    }
  });
});

describe("the super administrator has every administrator power", () => {
  it("is granted whatever ADMIN is granted", () => {
    // Written as a sweep rather than as a list, so a permission added later
    // cannot quietly exclude the most senior account in the system.
    for (const [name, allows] of Object.entries(can)) {
      if (!allows("ADMIN")) continue;
      expect(allows("SUPERADMIN"), `can.${name} excludes SUPERADMIN`).toBe(true);
    }
  });

  it("holds the three that are theirs alone", () => {
    for (const allows of [can.manageAccess, can.viewFinance, can.manageFinance]) {
      expect(allows("SUPERADMIN")).toBe(true);
      expect(allows("ADMIN")).toBe(false);
      expect(allows("HR")).toBe(false);
    }
  });

  it("works at a desk, not in the field", () => {
    expect(usesAdminPanel("SUPERADMIN")).toBe(true);
    expect(usesFieldPanel("SUPERADMIN")).toBe(false);
    expect(homeFor("SUPERADMIN")).toBe("/admin");
  });
});

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

  it("lets HR see what partners are owed without letting them say it has been paid", () => {
    expect(can.viewSales("HR")).toBe(true);
    expect(can.paySalesCommission("HR")).toBe(false);
    expect(can.paySalesCommission("ADMIN")).toBe(true);
    expect(can.paySalesCommission("SUPERADMIN")).toBe(true);
  });

  it("keeps coupons and delivery corrections with the administrator", () => {
    // Issuing a coupon directs commission at a person, and correcting a
    // delivery decides whether an order pays at all.
    expect(can.manageSales("ADMIN")).toBe(true);
    expect(can.manageSales("HR")).toBe(false);
    expect(can.viewSales("HR")).toBe(true);
  });

  it("lets the desk send a parcel without letting it redirect a commission", () => {
    // Booking freight and printing a label change no rate and no attribution,
    // so the shipping desk does not need the authority that issues coupons.
    expect(can.processOrders("HR")).toBe(true);
    expect(can.processOrders("ADMIN")).toBe(true);
    expect(can.manageSales("HR")).toBe(false);
  });

  it("keeps the affiliate operation away from the field panel entirely", () => {
    for (const role of ["MR", "SALES"] as const) {
      expect(can.viewSales(role)).toBe(false);
      expect(can.manageSales(role)).toBe(false);
      expect(can.processOrders(role)).toBe(false);
      expect(can.paySalesCommission(role)).toBe(false);
    }
  });

  it("keeps the warehouse count with the administrator", () => {
    expect(can.manageInventory("ADMIN")).toBe(true);
    expect(can.manageInventory("HR")).toBe(false);
    expect(can.viewAllStock("HR")).toBe(true);
    expect(can.manageInventory("MR")).toBe(false);
  });
});
