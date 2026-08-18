import { describe, expect, it } from "vitest";
import { decodeJwt } from "jose";
import {
  encodeSecret, PARTNER_ABSOLUTE_SECONDS, REFRESH_AFTER_SECONDS, sessionExhausted, shouldRefresh, signSessionToken,
  STAFF_ABSOLUTE_SECONDS, STAFF_IDLE_SECONDS, verifySession
} from "./token";

/**
 * The sliding session. Tested because the two clocks are what decide whether a
 * desk is signed out at lunchtime or kept in past a resignation.
 */
const secret = encodeSecret("test-secret-that-is-long-enough");
const T0 = 1_800_000_000;

describe("signSessionToken", () => {
  it("expires at the idle limit and stamps when the session began", async () => {
    const token = await signSessionToken("staff", { userId: "u1", role: "ADMIN" }, secret, { now: T0 });
    const payload = decodeJwt(token);
    expect(payload.exp).toBe(T0 + STAFF_IDLE_SECONDS);
    expect(payload.start).toBe(T0);
    expect(payload.userId).toBe("u1");
  });

  it("never expires past the absolute limit, however recently it was refreshed", async () => {
    const start = T0;
    const late = T0 + STAFF_ABSOLUTE_SECONDS - 60;
    const token = await signSessionToken("staff", { userId: "u1" }, secret, { start, now: late });
    expect(decodeJwt(token).exp).toBe(start + STAFF_ABSOLUTE_SECONDS);
  });

  it("marks a partner token with its audience", async () => {
    const token = await signSessionToken("partner", { repId: "r1" }, secret, { now: T0 });
    expect(decodeJwt(token).aud).toBe("partner");
  });
});

describe("verifySession", () => {
  it("returns the claims and no refresh on a young token", async () => {
    const token = await signSessionToken("staff", { userId: "u1", role: "HR" }, secret, { now: T0 });
    const verified = await verifySession("staff", token, secret, T0 + 60);
    expect(verified?.payload.userId).toBe("u1");
    expect(verified?.refreshed).toBeNull();
  });

  it("re-mints a token that has aged past the refresh interval, keeping its start", async () => {
    const token = await signSessionToken("staff", { userId: "u1", role: "HR" }, secret, { now: T0 });
    const later = T0 + REFRESH_AFTER_SECONDS + 5;
    const verified = await verifySession("staff", token, secret, later);
    expect(verified?.refreshed).toBeTruthy();
    const fresh = decodeJwt(verified!.refreshed!);
    expect(fresh.start).toBe(T0);
    expect(fresh.iat).toBe(later);
    expect(fresh.exp).toBe(later + STAFF_IDLE_SECONDS);
    expect(fresh.userId).toBe("u1");
    expect(fresh.role).toBe("HR");
  });

  it("signs out a session past the absolute limit even when the token itself is unexpired", async () => {
    const start = T0;
    const token = await signSessionToken("staff", { userId: "u1" }, secret, { start, now: start + STAFF_ABSOLUTE_SECONDS - 60 });
    // Not yet expired by `exp`, but the wall has arrived.
    expect(await verifySession("staff", token, secret, start + STAFF_ABSOLUTE_SECONDS - 30)).not.toBeNull();
    expect(await verifySession("staff", token, secret, start + STAFF_ABSOLUTE_SECONDS + 1)).toBeNull();
  });

  it("refuses a partner token as a staff session, and the reverse", async () => {
    const partner = await signSessionToken("partner", { repId: "r1" }, secret, { now: T0 });
    const staff = await signSessionToken("staff", { userId: "u1" }, secret, { now: T0 });
    expect(await verifySession("staff", partner, secret, T0)).toBeNull();
    expect(await verifySession("partner", staff, secret, T0)).toBeNull();
  });

  it("refuses a bad signature", async () => {
    const token = await signSessionToken("staff", { userId: "u1" }, secret, { now: T0 });
    expect(await verifySession("staff", token, encodeSecret("another-secret-entirely"), T0)).toBeNull();
  });

  it("treats a token minted before `start` existed as having started when it was issued", () => {
    const legacy = { iat: T0, exp: T0 + 3600, userId: "u1" };
    expect(sessionExhausted("staff", legacy, T0 + 60)).toBe(false);
    expect(sessionExhausted("partner", legacy, T0 + PARTNER_ABSOLUTE_SECONDS + 1)).toBe(true);
    expect(shouldRefresh("staff", legacy, T0 + REFRESH_AFTER_SECONDS)).toBe(true);
  });
});
