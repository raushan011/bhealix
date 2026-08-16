import { beforeAll, describe, expect, it } from "vitest";
import { anonymous, as } from "../support/client.mjs";
import { ACCOUNTS, TEST_PASSWORD } from "../support/config.mjs";
import { fixtures } from "../support/fixtures.mjs";

/**
 * Can somebody below the super administrator become one, or get at the account
 * that is?
 *
 * The role is only worth anything if the answer is no through every door, and
 * there are more doors than there look: `role` on two team endpoints, and on the
 * account itself a password reset, a deactivation and a delete. Each of those is
 * a complete takeover on its own — a password an administrator can set is an
 * account they can sign in as — and each is reached by `can.manageEmployees`,
 * which HR holds as well.
 */
describe("nobody below a super administrator can become one", () => {
  let ids;

  beforeAll(() => { ids = fixtures().users; });

  it("will not accept SUPERADMIN when creating an employee", async () => {
    for (const role of ["ADMIN", "HR"]) {
      const client = await as(role);
      const created = await client.post("/api/team", {
        name: "Sneaky Promotion",
        employeeId: `TEST-ESC-${role}`,
        email: `test-escalate-${role.toLowerCase()}@bhealix.test`,
        password: "TestOnly@12345",
        role: "SUPERADMIN"
      });
      expect(created.status, `${role} created a SUPERADMIN`).toBe(400);
    }
  });

  it("will not promote an existing account, including one's own", async () => {
    const admin = await as("ADMIN");
    // The obvious attempt: an administrator promoting themselves.
    expect((await admin.patch(`/api/team/${ids.ADMIN}`, { role: "SUPERADMIN" })).status).toBe(400);
    // And the sideways one: promoting somebody they control.
    expect((await admin.patch(`/api/team/${ids.HR}`, { role: "SUPERADMIN" })).status).toBe(400);

    const hr = await as("HR");
    expect((await hr.patch(`/api/team/${ids.HR}`, { role: "SUPERADMIN" })).status).toBe(400);
  });
});

describe("a super administrator's account is closed to everybody below them", () => {
  let ids;

  beforeAll(() => { ids = fixtures().users; });

  it("refuses a password reset, which would be a takeover", async () => {
    for (const role of ["ADMIN", "HR"]) {
      const client = await as(role);
      const reset = await client.patch(`/api/team/${ids.SUPERADMIN}`, { newPassword: "TakenOver@12345" });
      expect(reset.status, `${role} reset the super administrator's password`).toBe(403);
      expect(reset.error).toMatch(/shell/);
    }

    // And the password genuinely still works, rather than the refusal merely
    // having been reported.
    const still = await anonymous().post("/api/auth/login", {
      identifier: ACCOUNTS.SUPERADMIN.email, password: TEST_PASSWORD
    });
    expect(still.status).toBe(200);
  });

  it("refuses to deactivate or demote them", async () => {
    const admin = await as("ADMIN");
    expect((await admin.patch(`/api/team/${ids.SUPERADMIN}`, { active: false })).status).toBe(403);
    expect((await admin.patch(`/api/team/${ids.SUPERADMIN}`, { role: "ADMIN" })).status).toBe(403);
  });

  it("refuses to delete them", async () => {
    // Deleting the only account that can restore anybody's access is the same
    // denial of service as deactivating it, by another route.
    const admin = await as("ADMIN");
    const removed = await admin.delete(`/api/team/${ids.SUPERADMIN}`);
    expect(removed.status).toBe(403);
    expect(removed.error).toMatch(/super administrator/i);
  });

  it("still lets them edit their own record", async () => {
    const sup = await as("SUPERADMIN");
    expect((await sup.patch(`/api/team/${ids.SUPERADMIN}`, { designation: "Proprietor" })).status).toBe(200);
  });
});

describe("the super admin door at /super-admin", () => {
  it("refuses an account that is not a super administrator, without signing it in", async () => {
    const client = anonymous();
    const refused = await client.post("/api/auth/login", {
      identifier: ACCOUNTS.ADMIN.email, password: TEST_PASSWORD, scope: "super"
    });

    expect(refused.status).toBe(403);
    expect(refused.error).toMatch(/not a super administrator/i);
    // No cookie was set, so nothing has to be undone — the refusal happens
    // before the session is issued rather than after.
    expect(client.cookies.has("bhealix_session")).toBe(false);
  });

  it("says the password was wrong differently from the door being wrong", async () => {
    // A super administrator typing a correct password at the right door must
    // never be told "incorrect password"; they would conclude the account was
    // broken rather than that they were in the wrong place.
    const bad = await anonymous().post("/api/auth/login", {
      identifier: ACCOUNTS.SUPERADMIN.email, password: "not-the-password", scope: "super"
    });
    expect(bad.status).toBe(401);
    expect(bad.error).toMatch(/Incorrect/);
  });

  it("signs a super administrator straight into the control panel", async () => {
    const client = anonymous();
    const signedIn = await client.post("/api/auth/login", {
      identifier: ACCOUNTS.SUPERADMIN.email, password: TEST_PASSWORD, scope: "super"
    });

    expect(signedIn.status).toBe(200);
    // The panel, not the chooser: somebody who typed that address has chosen.
    expect(signedIn.data.redirectTo).toBe("/admin/control");
    expect(client.cookies.has("bhealix_session")).toBe(true);
  });

  it("leaves the ordinary sign-in exactly as it was", async () => {
    const normal = await anonymous().post("/api/auth/login", {
      identifier: ACCOUNTS.ADMIN.email, password: TEST_PASSWORD
    });
    expect(normal.status).toBe(200);
    expect(normal.data.redirectTo).toBe("/choose");
  });

  it("sends a signed-in super administrator through without asking again", async () => {
    const sup = await as("SUPERADMIN");
    const page = await sup.get("/super-admin", { raw: true });
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toMatch(/\/admin\/control$/);
  });

  it("is reachable signed out, being a sign-in page", async () => {
    const page = await anonymous().get("/super-admin", { raw: true });
    expect(page.status).toBe(200);
  });
});
