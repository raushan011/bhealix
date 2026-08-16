import { describe, expect, it } from "vitest";
import { grantedWorkspaces, mayEnter, panelsFor } from "./grants";

describe("grantedWorkspaces", () => {
  it("falls back to the role when nobody has decided", () => {
    // The state every account was in on the day grants shipped. Nothing may be
    // lost by adding a feature nobody has used yet.
    expect(grantedWorkspaces("ADMIN", undefined)).toEqual(["doctor", "sales"]);
    expect(grantedWorkspaces("HR", undefined)).toEqual(["doctor", "sales"]);
    expect(grantedWorkspaces("MR", undefined)).toEqual([]);
  });

  it("obeys an explicit decision, including the decision to give nothing", () => {
    expect(grantedWorkspaces("ADMIN", ["doctor"])).toEqual(["doctor"]);
    expect(grantedWorkspaces("ADMIN", [])).toEqual([]);
  });

  it("returns the panels in one order however they were stored", () => {
    expect(grantedWorkspaces("ADMIN", ["sales", "doctor"])).toEqual(["doctor", "sales"]);
  });
});

describe("mayEnter", () => {
  it("keeps the super admin panel to the super administrator", () => {
    expect(mayEnter("SUPERADMIN", undefined, "control")).toBe(true);
    expect(mayEnter("ADMIN", undefined, "control")).toBe(false);
  });

  it("will not let a grant open the super admin panel", () => {
    // The screen that hands out grants can only offer doctor and sales, but the
    // rule is stated here as well: a hand-edited database row must not be a way
    // in either.
    expect(mayEnter("ADMIN", ["doctor", "sales", "control"] as never, "control")).toBe(false);
  });

  it("shuts a withdrawn panel immediately", () => {
    expect(mayEnter("ADMIN", ["doctor"], "sales")).toBe(false);
    expect(mayEnter("ADMIN", ["doctor"], "doctor")).toBe(true);
  });

  it("holds no opinion about field staff, who have a panel of their own", () => {
    expect(mayEnter("MR", undefined, "doctor")).toBe(false);
    expect(mayEnter("SALES", undefined, "sales")).toBe(false);
  });
});

describe("panelsFor", () => {
  it("gives the super administrator their own panel on top of the CRMs", () => {
    expect(panelsFor("SUPERADMIN", undefined)).toEqual(["doctor", "sales", "control"]);
    // Withdrawing a CRM from a super administrator would be odd, but if it is
    // recorded it is obeyed — and the control panel stays, because it is theirs
    // by role.
    expect(panelsFor("SUPERADMIN", [])).toEqual(["control"]);
  });

  it("gives an administrator exactly what they hold", () => {
    expect(panelsFor("ADMIN", ["sales"])).toEqual(["sales"]);
    expect(panelsFor("ADMIN", [])).toEqual([]);
  });
});
