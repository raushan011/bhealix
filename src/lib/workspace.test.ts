import { describe, expect, it } from "vitest";
import { apiWorkspaceOf, executiveMayCall, GRANTABLE_WORKSPACES, isGrantable, workspaceOf } from "./workspace";

describe("workspaceOf", () => {
  it("reads each panel out of its own paths", () => {
    expect(workspaceOf("/admin/sales")).toBe("sales");
    expect(workspaceOf("/admin/sales/orders/new")).toBe("sales");
    expect(workspaceOf("/admin/affiliate")).toBe("affiliate");
    expect(workspaceOf("/admin/affiliate/payouts")).toBe("affiliate");
    expect(workspaceOf("/admin/leads")).toBe("leads");
    expect(workspaceOf("/admin/leads/retarget")).toBe("leads");
    expect(workspaceOf("/admin/control")).toBe("control");
    expect(workspaceOf("/admin/control/invoices")).toBe("control");
  });

  it("puts HR and the employee directory in their own panel, at the addresses they always had", () => {
    expect(workspaceOf("/admin/hr")).toBe("people");
    expect(workspaceOf("/admin/hr/payroll")).toBe("people");
    expect(workspaceOf("/admin/team")).toBe("people");
    expect(workspaceOf("/admin/team/new")).toBe("people");
  });

  it("treats everything else under /admin as the Doctor CRM", () => {
    expect(workspaceOf("/admin")).toBe("doctor");
    expect(workspaceOf("/admin/billing")).toBe("doctor");
    expect(workspaceOf("/admin/visits/day")).toBe("doctor");
  });

  it("does not mistake a longer sibling for the panel it starts like", () => {
    expect(workspaceOf("/admin/salespeople")).toBe("doctor");
    expect(workspaceOf("/admin/controls")).toBe("doctor");
    expect(workspaceOf("/admin/teams")).toBe("doctor");
    expect(workspaceOf("/admin/hrx")).toBe("doctor");
  });
});

describe("apiWorkspaceOf", () => {
  it("names the CRM an API path plainly belongs to", () => {
    expect(apiWorkspaceOf("/api/sales/orders")).toBe("affiliate");
    expect(apiWorkspaceOf("/api/sales/reps/abc")).toBe("affiliate");
    expect(apiWorkspaceOf("/api/sales-team/orders")).toBe("sales");
    expect(apiWorkspaceOf("/api/doctors/abc")).toBe("doctor");
    expect(apiWorkspaceOf("/api/hr/payroll")).toBe("people");
  });

  it("gives the affiliate API's prospecting corner to the Leads CRM", () => {
    for (const path of ["/api/sales/leads", "/api/sales/leads/search", "/api/sales/retarget/abc", "/api/sales/automation/run", "/api/sales/templates"]) {
      expect(apiWorkspaceOf(path)).toBe("leads");
    }
  });

  it("leaves the routes that belong to no CRM alone", () => {
    // Withdrawing a panel must not stop somebody signing in, reading their own
    // payslip, picking a colleague, or an affiliate reaching their own portal.
    for (const path of ["/api/auth/login", "/api/auth/change-password", "/api/partner/orders", "/api/finance/documents", "/api/team"]) {
      expect(apiWorkspaceOf(path)).toBeNull();
    }
  });

  it("ignores a trailing slash, which a fetch will happily send", () => {
    expect(apiWorkspaceOf("/api/sales/")).toBe("affiliate");
    expect(apiWorkspaceOf("/api/sales-team/")).toBe("sales");
  });

  it("does not match a path that merely begins with a guarded one", () => {
    expect(apiWorkspaceOf("/api/salesforce")).toBeNull();
    expect(apiWorkspaceOf("/api/doctorsomething")).toBeNull();
    expect(apiWorkspaceOf("/api/sales/leadsx")).toBe("affiliate");
  });
});

describe("executiveMayCall", () => {
  it("lets a sales executive reach the routes built for them", () => {
    for (const path of ["/api/sales-team/orders", "/api/sales-team/leads/abc", "/api/auth/me", "/api/auth/change-password", "/api/hr/leave", "/api/hr/leave/abc"]) {
      expect(executiveMayCall(path)).toBe(true);
    }
  });

  it("keeps them out of everything else, including routes that would show a field rep their own", () => {
    for (const path of ["/api/visits", "/api/invoices", "/api/doctors", "/api/samples/stock", "/api/sales/orders", "/api/sales/leads", "/api/hr/payroll", "/api/team", "/api/products", "/api/hr/leavex"]) {
      expect(executiveMayCall(path)).toBe(false);
    }
  });
});

describe("isGrantable", () => {
  it("accepts the panels that can be handed out and refuses the one that cannot", () => {
    expect(GRANTABLE_WORKSPACES).toEqual(["doctor", "people", "leads", "sales", "affiliate"]);
    expect(isGrantable("affiliate")).toBe(true);
    // The panel that hands out grants is never itself a grant, or an
    // administrator could let themselves into it.
    expect(isGrantable("control")).toBe(false);
    expect(isGrantable("payroll")).toBe(false);
  });
});
