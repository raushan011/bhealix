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

  it("keeps the warehouse count with the administrator", () => {
    expect(can.manageInventory("ADMIN")).toBe(true);
    expect(can.manageInventory("HR")).toBe(false);
    expect(can.viewAllStock("HR")).toBe(true);
    expect(can.manageInventory("MR")).toBe(false);
  });
});
