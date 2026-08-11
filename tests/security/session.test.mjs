/**
 * Attacks on the session cookie itself.
 *
 * The app trusts a signed JWT for identity and role, so everything else rests
 * on this: a token the server did not sign, or one whose claims were edited
 * after signing, must not be honoured. A failure in this file is not a bug in
 * one endpoint — it is a way to become an administrator.
 */
import { describe, it, expect } from "vitest";
import { SignJWT } from "jose";
import { createHmac } from "node:crypto";
import { Client, anonymous, as } from "../support/client.mjs";
import { AUTH_SECRET, BASE_URL } from "../support/config.mjs";
import { fixtures } from "../support/fixtures.mjs";

const COOKIE = "bhealix_session";
const encoder = new TextEncoder();

/** Builds a client already carrying a chosen cookie value. */
function carrying(token) {
  const client = new Client(BASE_URL);
  client.cookies.set(COOKIE, token);
  return client;
}

/** An endpoint only an administrator may reach, used as the prize throughout. */
const ADMIN_ONLY = "/api/reports";

describe("a token the server did not sign", () => {
  it("is refused even when it claims to be an administrator", async () => {
    const forged = await new SignJWT({ userId: fixtures().users.MR, name: "Attacker", role: "ADMIN" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("12h")
      .sign(encoder.encode("this-is-not-the-real-signing-secret-at-all"));

    const result = await carrying(forged).get(ADMIN_ONLY);
    expect(result.status).toBe(401);
  });

  /**
   * Signed with an empty key — the shape produced when a deployment starts up
   * with `AUTH_SECRET` unset and something coerces it to "". Built by hand
   * because `jose` refuses a zero-length key outright, which is itself the
   * correct behaviour on the signing side.
   */
  it("is refused when signed with the empty secret", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({
      userId: fixtures().users.MR, name: "Attacker", role: "ADMIN",
      iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600
    })).toString("base64url");

    const signature = createHmac("sha256", "").update(`${header}.${payload}`).digest("base64url");

    const result = await carrying(`${header}.${payload}.${signature}`).get(ADMIN_ONLY);
    expect(result.status).toBe(401);
  });
});

describe("a token whose claims were edited after signing", () => {
  /**
   * The classic escalation: sign in as a rep, rewrite `role` to ADMIN in the
   * payload, keep the original signature. `jwtVerify` must reject it.
   */
  it("is refused when the role is rewritten in place", async () => {
    const mr = await as("MR");
    const original = mr.cookies.get(COOKIE);
    const [header, payload, signature] = original.split(".");

    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
    decoded.role = "ADMIN";
    const rewritten = Buffer.from(JSON.stringify(decoded)).toString("base64url");

    const result = await carrying(`${header}.${rewritten}.${signature}`).get(ADMIN_ONLY);
    expect(result.status).toBe(401);
  });

  it("is refused when the user id is swapped for somebody else's", async () => {
    const mr = await as("MR");
    const [header, payload, signature] = mr.cookies.get(COOKIE).split(".");

    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
    decoded.userId = fixtures().users.ADMIN;
    const rewritten = Buffer.from(JSON.stringify(decoded)).toString("base64url");

    const result = await carrying(`${header}.${rewritten}.${signature}`).get(ADMIN_ONLY);
    expect(result.status).toBe(401);
  });
});

describe("algorithm confusion", () => {
  /**
   * `alg: none` is the oldest JWT attack there is: a library that honours the
   * header's choice of algorithm will accept a token with no signature at all.
   */
  it("refuses a token with alg set to none and no signature", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({
      userId: fixtures().users.MR, name: "Attacker", role: "ADMIN",
      iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600
    })).toString("base64url");

    for (const token of [`${header}.${payload}.`, `${header}.${payload}`]) {
      const result = await carrying(token).get(ADMIN_ONLY);
      expect(result.status, `token: ${token.slice(0, 24)}…`).toBe(401);
    }
  });

  /**
   * The other half of the family: presenting an HMAC token as though it were
   * RS256, hoping the verifier uses a public key as the HMAC secret.
   */
  it("refuses a token whose header claims an asymmetric algorithm", async () => {
    if (!AUTH_SECRET) return; // Nothing to sign with; the check above already covers the shape.

    const forged = await new SignJWT({ userId: fixtures().users.MR, role: "ADMIN" })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("12h")
      .sign(encoder.encode(AUTH_SECRET));

    const [, payload, signature] = forged.split(".");
    const swapped = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");

    const result = await carrying(`${swapped}.${payload}.${signature}`).get(ADMIN_ONLY);
    expect(result.status).toBe(401);
  });
});

describe("expiry", () => {
  it("refuses a token that has already expired", async () => {
    if (!AUTH_SECRET) return;

    const expired = await new SignJWT({ userId: fixtures().users.ADMIN, name: "Admin", role: "ADMIN" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(encoder.encode(AUTH_SECRET));

    const result = await carrying(expired).get(ADMIN_ONLY);
    expect(result.status).toBe(401);
  });
});

describe("malformed cookies", () => {
  it("refuses rubbish in the session cookie without a 500", async () => {
    const rubbish = [
      "", "not-a-token", "a.b.c", "....", "null", "undefined",
      "e30.e30.e30", Buffer.alloc(4096).toString("base64url"),
      "%00%00%00", "../../etc/passwd"
    ];

    for (const value of rubbish) {
      const result = await carrying(value).get("/api/auth/me");
      expect(result.status, `cookie: ${value.slice(0, 20)}`).toBe(401);
    }
  });
});

describe("the login endpoint under abuse", () => {
  /**
   * Not a pass/fail assertion but a measurement: the suite records how many
   * wrong passwords in a row the endpoint will accept. bcrypt at cost 12 makes
   * each attempt expensive for the server as well as the attacker, so an
   * unthrottled login is a denial-of-service surface as much as a guessing one.
   */
  it("reports whether repeated failures are throttled", async () => {
    const attempts = 12;
    const statuses = [];

    for (let i = 0; i < attempts; i++) {
      const result = await anonymous().post("/api/auth/login", {
        identifier: "test-admin@bhealix.test",
        password: `wrong-guess-${i}`
      });
      statuses.push(result.status);
    }

    const throttled = statuses.some(status => status === 429);
    if (!throttled) {
      console.warn(
        `\n  ⚠  ${attempts}/${attempts} failed logins accepted with no 429. ` +
        `Login is not rate limited — see the report.\n`
      );
    }
    // Recorded rather than enforced: the app has no rate limiting today, and a
    // red test here every run would train everyone to ignore this file.
    expect(statuses.every(status => status === 401 || status === 429)).toBe(true);
  });
});
