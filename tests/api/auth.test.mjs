import { describe, it, expect } from "vitest";
import { Client, anonymous, as } from "../support/client.mjs";
import { ACCOUNTS, TEST_PASSWORD } from "../support/config.mjs";

const COOKIE = "bhealix_session";

describe("POST /api/auth/login", () => {
  it("signs in with an email address and returns the role's home", async () => {
    const client = new Client();
    const result = await client.post("/api/auth/login", {
      identifier: ACCOUNTS.ADMIN.email,
      password: TEST_PASSWORD
    });

    expect(result.status).toBe(200);
    expect(result.data.role).toBe("ADMIN");
    expect(result.data.redirectTo).toBe("/admin");
    expect(client.cookies.has(COOKIE)).toBe(true);
  });

  it("signs in with an employee ID just as well as an email", async () => {
    const client = new Client();
    const result = await client.post("/api/auth/login", {
      identifier: ACCOUNTS.MR.employeeId,
      password: TEST_PASSWORD
    });

    expect(result.status).toBe(200);
    expect(result.data.role).toBe("MR");
    expect(result.data.redirectTo).toBe("/employee");
  });

  it("issues the session as an httpOnly cookie that script cannot read", async () => {
    const client = new Client();
    const response = await client.request("POST", "/api/auth/login", {
      body: { identifier: ACCOUNTS.ADMIN.email, password: TEST_PASSWORD },
      raw: true
    });

    const cookie = response.headers.getSetCookie().find(entry => entry.startsWith(COOKIE));
    expect(cookie).toBeDefined();
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toContain("samesite=lax");
  });

  it("refuses a wrong password", async () => {
    const result = await anonymous().post("/api/auth/login", {
      identifier: ACCOUNTS.ADMIN.email,
      password: "definitely-not-the-password"
    });
    expect(result.status).toBe(401);
  });

  /**
   * The login route answers identically for both, which is what stops the form
   * being used to find out which addresses have accounts.
   */
  it("does not reveal whether an account exists", async () => {
    const unknown = await anonymous().post("/api/auth/login", {
      identifier: "nobody-here@bhealix.test", password: "whatever"
    });
    const wrongPassword = await anonymous().post("/api/auth/login", {
      identifier: ACCOUNTS.ADMIN.email, password: "whatever"
    });

    expect(unknown.status).toBe(wrongPassword.status);
    expect(unknown.error).toBe(wrongPassword.error);
  });

  it("rejects a malformed body without a 500", async () => {
    for (const body of [{}, { identifier: "a" }, { identifier: ACCOUNTS.ADMIN.email }, { password: "x" }]) {
      const result = await anonymous().post("/api/auth/login", body);
      expect(result.status, `body: ${JSON.stringify(body)}`).toBe(400);
    }
  });

  it("never returns the password hash", async () => {
    const result = await anonymous().post("/api/auth/login", {
      identifier: ACCOUNTS.ADMIN.email, password: TEST_PASSWORD
    });
    expect(result.text).not.toContain("passwordHash");
    expect(result.text).not.toContain("$2b$");
  });
});

describe("GET /api/auth/me", () => {
  it("returns the signed-in user", async () => {
    const client = await as("HR");
    const result = await client.get("/api/auth/me");
    expect(result.status).toBe(200);
    expect(result.data.role).toBe("HR");
  });

  it("refuses an anonymous caller", async () => {
    const result = await anonymous().get("/api/auth/me");
    expect(result.status).toBe(401);
  });
});

describe("POST /api/auth/logout", () => {
  it("clears the session so the next request is anonymous again", async () => {
    const client = await as("ADMIN");
    expect((await client.get("/api/auth/me")).status).toBe(200);

    await client.logout();

    const after = await client.get("/api/auth/me");
    expect(after.status).toBe(401);
  });
});

describe("POST /api/auth/change-password", () => {
  it("refuses an anonymous caller", async () => {
    const result = await anonymous().post("/api/auth/change-password", {
      currentPassword: TEST_PASSWORD, newPassword: "SomethingElse@123"
    });
    expect(result.status).toBe(401);
  });

  it("refuses when the current password is wrong", async () => {
    const client = await as("SALES");
    const result = await client.post("/api/auth/change-password", {
      currentPassword: "not-the-current-one",
      newPassword: "SomethingElse@123"
    });
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.status).toBeLessThan(500);
  });
});
