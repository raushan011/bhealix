import { describe, expect, it } from "vitest";
import { ROLES, ROLE_LABEL, usesAdminPanel, usesFieldPanel } from "@/constants/access";
import { parseCoupon } from "./coupons";
import {
  couponSetupOf, generatedCode, generatedCodeProblem, mayHoldSession, mayTrade, setupIsStale,
  passwordProblem, refusalFor, repCodeProblem, repStatusOf, suggestRepCode
} from "./partners";

/**
 * The rules that decide who may mint a coupon and what they may call it.
 *
 * Tested rather than trusted because both halves are load-bearing in the same
 * way the commission arithmetic is: the first decides whether a stranger can
 * direct money at themselves, and the second decides whether they can direct
 * somebody else's money at themselves.
 */

/**
 * The two populations, held apart.
 *
 * This application runs two businesses that both use the word "sales", and
 * conflating them is the most expensive mistake available in it: a sales
 * partner given a staff role would appear in the HR register and, worse, in the
 * collection payroll iterates over when it pays salaries. These assertions are
 * here so the separation fails a test rather than failing quietly in a payroll
 * month.
 */
describe("sales partners are not sales employees", () => {
  it("has no affiliate role, because an affiliate is not staff", () => {
    // A `SalesRep` is its own collection with its own credentials and its own
    // portal. If somebody ever adds "PARTNER" or "AFFILIATE" to ROLES, they are
    // about to give an outsider an employee record — this is where they find out.
    //
    // SUPERADMIN joined the list when panel grants shipped, and is exactly the
    // kind of addition this assertion is meant to make somebody stop and think
    // about: it is a staff role, held by one person, with an employee record
    // like any other. An affiliate role would not be.
    expect(ROLES).toEqual(["SUPERADMIN", "ADMIN", "HR", "MR", "SALES"]);
  });

  it("names the staff role so it cannot be read as an affiliate", () => {
    // "Sales executive" was ambiguous against "sales partner"; "field" is what
    // makes it unmistakably the employee walking a round of clinics.
    expect(ROLE_LABEL.SALES).toBe("Field sales executive");
    expect(ROLE_LABEL.SALES.toLowerCase()).not.toContain("partner");
  });

  it("keeps the staff sales role in the field panel and out of the desk", () => {
    expect(usesFieldPanel("SALES")).toBe(true);
    expect(usesAdminPanel("SALES")).toBe(false);
  });
});

describe("repStatusOf", () => {
  it("reads a status when there is one", () => {
    expect(repStatusOf({ status: "Pending" })).toBe("Pending");
    expect(repStatusOf({ status: "Suspended" })).toBe("Suspended");
  });

  /*
   * The single most consequential default in this file. Every rep on record
   * before self-registration existed was typed in by an administrator, which is
   * the approval. Reading a missing status as `Pending` would have put the whole
   * existing sales team into an approvals queue on the morning of the deploy and
   * stopped their codes earning until somebody clicked through all of them.
   */
  it("treats a rep with no status as approved, because an administrator created them", () => {
    expect(repStatusOf({})).toBe("Active");
    expect(repStatusOf(null)).toBe("Active");
    expect(repStatusOf(undefined)).toBe("Active");
  });

  it("does not take a value that is not a status", () => {
    expect(repStatusOf({ status: "approved" })).toBe("Active");
    expect(repStatusOf({ status: "" })).toBe("Active");
  });
});

describe("mayHoldSession", () => {
  it("lets somebody waiting sign in, so the portal can tell them they are waiting", () => {
    expect(mayHoldSession("Pending")).toBe(true);
    expect(mayHoldSession("Active")).toBe(true);
  });

  it("refuses anybody turned away or put out", () => {
    expect(mayHoldSession("Rejected")).toBe(false);
    expect(mayHoldSession("Suspended")).toBe(false);
  });
});

describe("mayTrade", () => {
  it("needs both an approved account and the attribution switch on", () => {
    expect(mayTrade({ status: "Active", active: true })).toBe(true);
    expect(mayTrade({ status: "Active", active: false })).toBe(false);
    expect(mayTrade({ status: "Pending", active: true })).toBe(false);
    expect(mayTrade({ status: "Suspended", active: true })).toBe(false);
  });

  it("lets a rep from before the portal trade, as they always could", () => {
    expect(mayTrade({ active: true })).toBe(true);
    expect(mayTrade({})).toBe(true);
  });

  it("refuses nothing at all", () => {
    expect(mayTrade(null)).toBe(false);
    expect(mayTrade(undefined)).toBe(false);
  });
});

describe("refusalFor", () => {
  it("says nothing when there is nothing to say", () => {
    expect(refusalFor("Active", true)).toBeNull();
  });

  it("explains every other case in a sentence", () => {
    for (const status of ["Pending", "Rejected", "Suspended"] as const) {
      expect(refusalFor(status, true)).toBeTruthy();
    }
    expect(refusalFor("Active", false)).toContain("switched off");
  });
});

describe("couponSetupOf", () => {
  it("reads the state when the coupon carries one", () => {
    expect(couponSetupOf({ setup: "Awaiting setup" })).toBe("Awaiting setup");
    expect(couponSetupOf({ setup: "Failed" })).toBe("Failed");
  });

  // Every code on record before self-service was typed in *because* Shopify
  // already had it. Anything else would flag the whole catalogue as broken.
  it("treats a coupon with no state as live", () => {
    expect(couponSetupOf({})).toBe("Live");
    expect(couponSetupOf(null)).toBe("Live");
    expect(couponSetupOf({ setup: "nonsense" })).toBe("Live");
  });
});

describe("suggestRepCode", () => {
  it("takes the first name when it is worth saying", () => {
    expect(suggestRepCode("Priya Sharma")).toBe("PRIYA");
    expect(suggestRepCode("raushan kumar")).toBe("RAUSHAN");
  });

  it("takes the surname too when the first name is too short to stand alone", () => {
    expect(suggestRepCode("Amy Roy")).toBe("AMYROY");
  });

  it("strips anything that cannot be in a coupon code", () => {
    // The apostrophe splits the name, and the two halves rejoin — which is what
    // makes D'Souza a usable code rather than a refused one.
    expect(suggestRepCode("D'Souza, Maria")).toBe("DSOUZA");
    expect(suggestRepCode("  shree   shathya  ")).toBe("SHREE");
  });

  it("never starts with a digit, because a discount code may not", () => {
    expect(suggestRepCode("24 Karat Salon")).toBe("KARAT");
  });

  it("has nothing to suggest for nothing", () => {
    expect(suggestRepCode("")).toBe("");
    expect(suggestRepCode("!!!")).toBe("");
  });
});

describe("repCodeProblem", () => {
  it("accepts an ordinary code", () => {
    expect(repCodeProblem("PRIYA")).toBeNull();
    expect(repCodeProblem("RAUSHAN2K")).toBeNull();
  });

  it("refuses spaces, punctuation and a leading digit", () => {
    expect(repCodeProblem("PRIYA SHARMA")).toBeTruthy();
    expect(repCodeProblem("2PRIYA")).toBeTruthy();
    expect(repCodeProblem("P")).toBeTruthy();
    expect(repCodeProblem("")).toBeTruthy();
    expect(repCodeProblem("A".repeat(25))).toBeTruthy();
  });
});

describe("passwordProblem", () => {
  it("wants eight characters and not only digits", () => {
    expect(passwordProblem("correct horse")).toBeNull();
    expect(passwordProblem("short")).toBeTruthy();
    expect(passwordProblem("12345678")).toBeTruthy();
  });
});

describe("generatedCode", () => {
  it("puts the rep's code at the front and the rule's digits at the end", () => {
    expect(generatedCode("PRIYA", "30")).toBe("PRIYA30");
    expect(generatedCode("priya", "30", "kit")).toBe("PRIYAKIT30");
  });
});

describe("generatedCodeProblem", () => {
  it("accepts a code built the way the generator builds them", () => {
    expect(generatedCodeProblem("PRIYA30", "PRIYA", "30")).toBeNull();
    expect(generatedCodeProblem("PRIYAKIT30", "PRIYA", "30")).toBeNull();
  });

  /*
   * The rule the whole feature rests on. Without it a rep could mint DIWALI30 —
   * a code indistinguishable from the company's own campaign — and collect
   * commission on every order the marketing department's promotion brought in.
   */
  it("refuses a code that does not start with the rep's own code", () => {
    expect(generatedCodeProblem("DIWALI30", "PRIYA", "30")).toContain("PRIYA");
    expect(generatedCodeProblem("RAUSHAN30", "PRIYA", "30")).toBeTruthy();
  });

  it("refuses a code that does not end in the rule's digits", () => {
    expect(generatedCodeProblem("PRIYA10", "PRIYA", "30")).toContain("30");
    expect(generatedCodeProblem("PRIYA", "PRIYA", "30")).toBeTruthy();
  });

  it("refuses digits in the middle, so the code still describes itself", () => {
    expect(generatedCodeProblem("PRIYA2030", "PRIYA", "30")).toBeTruthy();
  });

  it("refuses spaces, punctuation and anything over-long", () => {
    expect(generatedCodeProblem("PRIYA KIT30", "PRIYA", "30")).toBeTruthy();
    expect(generatedCodeProblem("PRIYA-KIT30", "PRIYA", "30")).toBeTruthy();
    expect(generatedCodeProblem(`PRIYA${"A".repeat(40)}30`, "PRIYA", "30")).toBeTruthy();
    expect(generatedCodeProblem("PRIYATOOMANYLETTERS30", "PRIYA", "30")).toBeTruthy();
  });

  /**
   * The invariant the middle-is-letters rule exists to protect: a code this
   * function accepts is one `parseCoupon` reads back the same way, so the sync's
   * fallback and the stored suffix cannot disagree.
   */
  it("only accepts codes that parse back to the rule they were made for", () => {
    for (const [middle, suffix] of [["", "30"], ["KIT", "30"], ["", "10"], ["GLOW", "100"]] as const) {
      const code = generatedCode("PRIYA", suffix, middle);
      expect(generatedCodeProblem(code, "PRIYA", suffix)).toBeNull();
      expect(parseCoupon(code)?.suffix).toBe(suffix);
    }
  });

  /*
   * The one case the letters cannot describe: a rep code that itself ends in a
   * digit moves where `parseCoupon` splits. The code is still accepted, because
   * refusing it would refuse a legitimate rep code — and attribution is safe
   * regardless, since the suffix stored on the coupon is what the sync uses and
   * `parseCoupon` is only its fallback. Written down so the next reader who
   * notices the discrepancy finds the answer rather than the bug they suspect.
   */
  it("accepts a rep code ending in a digit, where the letters no longer describe the rule", () => {
    expect(generatedCodeProblem("PRIYA130", "PRIYA1", "30")).toBeNull();
    expect(parseCoupon("PRIYA130")?.suffix).toBe("130");
  });
});

describe("a setup state the shop has overtaken", () => {
  /**
   * The case this exists for: an administrator made the discount in Shopify by
   * hand, nothing told this side, and the row sat at "Awaiting setup" over a
   * code that had been working for a fortnight — while the partner's own portal
   * told them it would not work at the checkout.
   */
  it("is stale when Shopify lists the code live and the record does not", () => {
    expect(setupIsStale({ setup: "Awaiting setup" }, true)).toBe(true);
    expect(setupIsStale({ setup: "Failed" }, true)).toBe(true);
  });

  it("is not stale when the record already agrees", () => {
    expect(setupIsStale({ setup: "Live" }, true)).toBe(false);
  });

  /**
   * One-way, and this is the half that matters. Shopify not listing a code
   * proves nothing — paused, scheduled, ended, or on a page the catalogue has
   * not read — and marking a working code as broken would be worse than the
   * stale row it set out to fix.
   */
  it("never reads the shop's silence as a code being broken", () => {
    expect(setupIsStale({ setup: "Awaiting setup" }, false)).toBe(false);
    expect(setupIsStale({ setup: "Failed" }, false)).toBe(false);
    expect(setupIsStale({ setup: "Live" }, false)).toBe(false);
  });

  /**
   * A coupon with no `setup` at all was typed in by an administrator because
   * Shopify already had it — `couponSetupOf` reads that as Live, so there is
   * nothing to correct and no pointless write.
   */
  it("leaves a hand-entered coupon alone", () => {
    expect(setupIsStale({}, true)).toBe(false);
    expect(setupIsStale(undefined, true)).toBe(false);
    expect(setupIsStale({ setup: null }, true)).toBe(false);
  });
});
