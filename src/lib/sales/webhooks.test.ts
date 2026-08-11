import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWebhook, WEBHOOK_PATH, WEBHOOK_TOPICS } from "./webhooks";

const SECRET = "shpss_test_client_secret";
const sign = (body: string, secret = SECRET) => createHmac("sha256", secret).update(body, "utf8").digest("base64");

const BODY = JSON.stringify({ id: 7214067482854, name: "#1791", discount_codes: [{ code: "SATHYA30" }] });

describe("verifyWebhook", () => {
  it("accepts a body Shopify signed", () => {
    expect(verifyWebhook(BODY, sign(BODY), SECRET)).toBe(true);
  });

  it("rejects a body signed with a different secret", () => {
    expect(verifyWebhook(BODY, sign(BODY, "someone-elses-secret"), SECRET)).toBe(false);
  });

  it("rejects a body that was altered after signing", () => {
    // The whole attack this guards against: a forged order, or a real one with
    // the coupon swapped to point the commission at somebody else.
    const tampered = BODY.replace("SATHYA30", "ATTACKER30");
    expect(verifyWebhook(tampered, sign(BODY), SECRET)).toBe(false);
  });

  it("rejects a missing, empty or malformed signature", () => {
    expect(verifyWebhook(BODY, null, SECRET)).toBe(false);
    expect(verifyWebhook(BODY, "", SECRET)).toBe(false);
    expect(verifyWebhook(BODY, "not-base64-of-32-bytes", SECRET)).toBe(false);
  });

  it("rejects everything when no secret is stored", () => {
    // Better to refuse every delivery than to accept unverified order data
    // straight into the commission ledger.
    expect(verifyWebhook(BODY, sign(BODY), "")).toBe(false);
  });

  it("is signed over the raw bytes, not over the parsed object", () => {
    // Re-serialising changes key order and whitespace. If the route ever parses
    // first and verifies second, this is the test that fails.
    const reserialised = JSON.stringify(JSON.parse(BODY.replace('{"id"', '{ "id"')));
    const spaced = BODY.replace('{"id"', '{ "id"');
    expect(verifyWebhook(spaced, sign(spaced), SECRET)).toBe(true);
    expect(verifyWebhook(reserialised, sign(spaced), SECRET)).toBe(false);
  });
});

describe("the subscription itself", () => {
  it("covers the three ways an order changes what somebody is owed", () => {
    expect([...WEBHOOK_TOPICS]).toEqual(["orders/create", "orders/updated", "orders/cancelled"]);
  });

  it("points at the public route, which is what the middleware lets through", () => {
    expect(WEBHOOK_PATH).toBe("/api/sales/shopify/webhook");
  });
});
