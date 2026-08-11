import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { authorizeUrl, redirectUri, safeShopDomain, verifyCallback } from "./oauth";

const SECRET = "shpss_test_client_secret";

/** Signs a query the way Shopify does, so the verifier can be tested honestly. */
function signed(params: Record<string, string>, secret = SECRET): URLSearchParams {
  const message = Object.keys(params).sort().map(key => `${key}=${params[key]}`).join("&");
  const query = new URLSearchParams(params);
  query.set("hmac", createHmac("sha256", secret).update(message).digest("hex"));
  return query;
}

describe("safeShopDomain", () => {
  it("accepts a shop address, and the admin URL it is usually copied from", () => {
    expect(safeShopDomain("vapvrf-0z.myshopify.com")).toBe("vapvrf-0z.myshopify.com");
    expect(safeShopDomain("https://admin.shopify.com/store/vapvrf-0z")).toBe("vapvrf-0z.myshopify.com");
    expect(safeShopDomain("vapvrf-0z")).toBe("vapvrf-0z.myshopify.com");
  });

  it("refuses anything that is not a Shopify shop", () => {
    // This is the input an attacker controls on the callback, and it becomes the
    // host we post the client secret to. It has to be shut completely.
    expect(() => safeShopDomain("evil.example.com")).toThrow();
    expect(() => safeShopDomain("www.bhealix.com")).toThrow();
    // The near-miss that matters: a suffix match would let this through.
    expect(() => safeShopDomain("shop.myshopify.com.evil.com")).toThrow();
    expect(() => safeShopDomain("")).toThrow();
    expect(() => safeShopDomain(null)).toThrow();
  });

  it("discards a path rather than letting it reach the host", () => {
    // Everything after the first slash is dropped, so a traversal attempt
    // simply is not there any more by the time the domain is checked.
    expect(safeShopDomain("shop.myshopify.com/../evil")).toBe("shop.myshopify.com");
    expect(safeShopDomain("shop.myshopify.com/admin/oauth")).toBe("shop.myshopify.com");
  });
});

describe("authorizeUrl", () => {
  const url = authorizeUrl({
    shop: "vapvrf-0z", clientId: "abc123", appUrl: "https://crm.bhealix.com/", state: "nonce-1"
  });

  it("sends the merchant to their own shop", () => {
    expect(url.startsWith("https://vapvrf-0z.myshopify.com/admin/oauth/authorize?")).toBe(true);
  });

  it("asks for the scopes the sync needs and nothing else", () => {
    expect(new URL(url).searchParams.get("scope")).toBe("read_orders,read_products");
  });

  it("asks for an offline token, so the nightly sync survives the tab closing", () => {
    expect(new URL(url).searchParams.getAll("grant_options[]")).toEqual([""]);
  });

  it("carries the nonce and a redirect that matches the registered one", () => {
    const params = new URL(url).searchParams;
    expect(params.get("state")).toBe("nonce-1");
    expect(params.get("redirect_uri")).toBe("https://crm.bhealix.com/api/sales/shopify/callback");
  });
});

describe("redirectUri", () => {
  it("does not double the slash, whatever the app URL ends with", () => {
    expect(redirectUri("https://crm.bhealix.com")).toBe("https://crm.bhealix.com/api/sales/shopify/callback");
    expect(redirectUri("https://crm.bhealix.com///")).toBe("https://crm.bhealix.com/api/sales/shopify/callback");
  });
});

describe("verifyCallback", () => {
  const params = { code: "abc", shop: "vapvrf-0z.myshopify.com", state: "nonce-1", timestamp: "1786500000" };

  it("accepts a query Shopify signed", () => {
    expect(verifyCallback(signed(params), SECRET)).toBe(true);
  });

  it("rejects one signed with a different secret", () => {
    expect(verifyCallback(signed(params, "wrong-secret"), SECRET)).toBe(false);
  });

  it("rejects a tampered parameter", () => {
    const query = signed(params);
    query.set("shop", "evil.myshopify.com");
    expect(verifyCallback(query, SECRET)).toBe(false);
  });

  it("rejects a missing or malformed signature", () => {
    const query = new URLSearchParams(params);
    expect(verifyCallback(query, SECRET)).toBe(false);
    query.set("hmac", "nonsense");
    expect(verifyCallback(query, SECRET)).toBe(false);
    // A short hex string must not slip through the length check.
    query.set("hmac", "abcdef");
    expect(verifyCallback(query, SECRET)).toBe(false);
  });

  it("ignores the signature fields themselves when rebuilding the message", () => {
    const query = signed(params);
    query.set("signature", "legacy-value");
    expect(verifyCallback(query, SECRET)).toBe(true);
  });

  it("verifies a value carrying a percent-escape, whichever form Shopify signed", () => {
    // `host` is base64 and can contain "=". The two encodings of that differ,
    // and both are accepted deliberately.
    const withHost = { ...params, host: "YWRtaW4uc2hvcGlmeS5jb20vc3RvcmU=" };
    expect(verifyCallback(signed(withHost), SECRET)).toBe(true);
  });
});
