import { describe, expect, it } from "vitest";
import { apiWorkspaceOf, GRANTABLE_WORKSPACES, isGrantable, workspaceOf } from "./workspace";

describe("workspaceOf", () => {
  it("reads the affiliate and super admin panels out of their own paths", () => {
    expect(workspaceOf("/admin/sales")).toBe("sales");
    expect(workspaceOf("/admin/sales/payouts")).toBe("sales");
    expect(workspaceOf("/admin/control")).toBe("control");
    expect(workspaceOf("/admin/control/invoices")).toBe("control");
  });

  it("treats everything else under /admin as the Doctor CRM", () => {
    expect(workspaceOf("/admin")).toBe("doctor");
    expect(workspaceOf("/admin/hr/payroll")).toBe("doctor");
    expect(workspaceOf("/admin/billing")).toBe("doctor");
  });

  it("does not mistake a longer sibling for the panel it starts like", () => {
    // /admin/salespeople is not the Sales CRM, and /admin/controls is not the
    // super admin panel. Prefix matching without the separator would say so.
    expect(workspaceOf("/admin/salespeople")).toBe("doctor");
    expect(workspaceOf("/admin/controls")).toBe("doctor");
  });
});

describe("apiWorkspaceOf", () => {
  it("names the CRM an API path plainly belongs to", () => {
    expect(apiWorkspaceOf("/api/sales/orders")).toBe("sales");
    expect(apiWorkspaceOf("/api/doctors/abc")).toBe("doctor");
    expect(apiWorkspaceOf("/api/hr/payroll")).toBe("doctor");
  });

  it("leaves the routes that belong to no CRM alone", () => {
    // Withdrawing a panel must not stop somebody signing in, reading their own
    // payslip, or an affiliate reaching their own portal.
    for (const path of ["/api/auth/login", "/api/auth/change-password", "/api/partner/orders", "/api/finance/documents"]) {
      expect(apiWorkspaceOf(path)).toBeNull();
    }
  });

  it("ignores a trailing slash, which a fetch will happily send", () => {
    expect(apiWorkspaceOf("/api/sales/")).toBe("sales");
    expect(apiWorkspaceOf("/api/sales")).toBe("sales");
  });

  it("does not match a path that merely begins with a guarded one", () => {
    expect(apiWorkspaceOf("/api/salesforce")).toBeNull();
    expect(apiWorkspaceOf("/api/doctorsomething")).toBeNull();
  });
});

describe("isGrantable", () => {
  it("accepts the two panels that can be handed out and refuses the one that cannot", () => {
    expect(GRANTABLE_WORKSPACES).toEqual(["doctor", "sales"]);
    expect(isGrantable("doctor")).toBe(true);
    // The panel that hands out grants is never itself a grant, or an
    // administrator could let themselves into it.
    expect(isGrantable("control")).toBe(false);
    expect(isGrantable("payroll")).toBe(false);
  });
});
