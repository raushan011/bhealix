import { describe, expect, it } from "vitest";
import { GRANT_VERSION, grantedWorkspaces, mayEnter, panelsFor, storedGrantOf } from "./grants";

const ALL = ["doctor", "people", "leads", "sales", "affiliate"];

describe("grantedWorkspaces", () => {
  it("falls back to the role when nobody has decided", () => {
    // Nothing may be lost by adding a feature nobody has used yet.
    expect(grantedWorkspaces("ADMIN", undefined)).toEqual(ALL);
    expect(grantedWorkspaces("HR", undefined)).toEqual(ALL);
    expect(grantedWorkspaces("MR", undefined)).toEqual([]);
    expect(grantedWorkspaces("EXECUTIVE", undefined)).toEqual([]);
  });

  it("obeys an explicit decision, including the decision to give nothing", () => {
    expect(grantedWorkspaces("ADMIN", ["doctor"])).toEqual(["doctor"]);
    expect(grantedWorkspaces("ADMIN", [])).toEqual([]);
  });

  it("returns the panels in one order however they were stored", () => {
    expect(grantedWorkspaces("ADMIN", ["affiliate", "doctor", "sales"])).toEqual(["doctor", "sales", "affiliate"]);
  });
});

describe("storedGrantOf", () => {
  it("reads a grant written before the split as what it meant then", () => {
    // The Doctor CRM used to hold HR; the Sales CRM held leads and affiliates.
    // Somebody granted either keeps everything they could open on the day it
    // was granted.
    expect(storedGrantOf(["doctor"], undefined)).toEqual(["doctor", "people"]);
    expect(storedGrantOf(["sales"], undefined)).toEqual(["leads", "affiliate", "sales"]);
    expect(storedGrantOf([], undefined)).toEqual([]);
  });

  it("reads a grant written since as exactly what it says", () => {
    expect(storedGrantOf(["doctor"], GRANT_VERSION)).toEqual(["doctor"]);
    expect(storedGrantOf(["sales"], GRANT_VERSION)).toEqual(["sales"]);
    expect(storedGrantOf(["control", "people"], GRANT_VERSION)).toEqual(["people"]);
  });

  it("keeps absent as absent", () => {
    expect(storedGrantOf(undefined, undefined)).toBeUndefined();
    expect(storedGrantOf(null, GRANT_VERSION)).toBeUndefined();
  });
});

describe("mayEnter", () => {
  it("keeps the super admin panel to the super administrator", () => {
    expect(mayEnter("SUPERADMIN", undefined, "control")).toBe(true);
    expect(mayEnter("ADMIN", undefined, "control")).toBe(false);
  });

  it("will not let a grant open the super admin panel", () => {
    expect(mayEnter("ADMIN", ["doctor", "sales", "control"] as never, "control")).toBe(false);
  });

  it("shuts a withdrawn panel immediately", () => {
    expect(mayEnter("ADMIN", ["doctor"], "sales")).toBe(false);
    expect(mayEnter("ADMIN", ["doctor"], "doctor")).toBe(true);
  });

  it("holds no opinion about people with a panel of their own", () => {
    expect(mayEnter("MR", undefined, "doctor")).toBe(false);
    expect(mayEnter("SALES", undefined, "sales")).toBe(false);
    expect(mayEnter("EXECUTIVE", undefined, "sales")).toBe(false);
    expect(mayEnter("EXECUTIVE", ["sales"], "sales")).toBe(false);
  });
});

describe("panelsFor", () => {
  it("gives the super administrator their own panel on top of the CRMs", () => {
    expect(panelsFor("SUPERADMIN", undefined)).toEqual([...ALL, "control"]);
    expect(panelsFor("SUPERADMIN", [])).toEqual(["control"]);
  });

  it("gives an administrator exactly what they hold", () => {
    expect(panelsFor("ADMIN", ["sales"])).toEqual(["sales"]);
    expect(panelsFor("ADMIN", [])).toEqual([]);
  });

  it("gives a sales executive none of the desk's panels", () => {
    expect(panelsFor("EXECUTIVE", undefined)).toEqual([]);
  });
});
