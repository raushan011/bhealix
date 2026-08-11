import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { httpJson, IntegrationError } from "./http";
import { normaliseDomain } from "./shopify";

/**
 * Connecting to Shopify by OAuth.
 *
 * Shopify stopped allowing new **legacy custom apps** on 1 January 2026 — the
 * kind that handed you an `shpat_` token to paste into a box. Everything is now
 * a Dev Dashboard app, which authenticates the ordinary way: send the merchant
 * to Shopify, they approve the scopes, Shopify sends back a code, and the code
 * is exchanged for a permanent offline access token.
 *
 * The token that comes out the far end is the same kind of token as before, so
 * nothing downstream of this file changed. Pasting one by hand still works for
 * shops that already have a legacy app.
 *
 * Three things here are security-critical, and each is commented where it sits:
 * the shop domain is validated before it is ever put in a URL, the callback's
 * HMAC is checked with a timing-safe comparison, and the `state` nonce has to
 * match the one we issued.
 */

/** Offline access, so the sync can run at one in the morning with nobody signed in. */
export const DEFAULT_SCOPES = ["read_orders", "read_products"] as const;

export const CALLBACK_PATH = "/api/sales/shopify/callback";
export const OAUTH_STATE_COOKIE = "bhealix_shopify_oauth";

/**
 * A shop domain fit to put in a URL.
 *
 * This is the one input in the whole flow that an attacker could choose, and it
 * is interpolated straight into a hostname we then send a secret to. Anything
 * that is not `<handle>.myshopify.com` is refused outright — without this, a
 * crafted `shop` parameter on the callback would have us post the client secret
 * to somebody else's server.
 */
const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export function safeShopDomain(value: string | null | undefined): string {
  const domain = normaliseDomain(value ?? "");
  if (!SHOP_DOMAIN.test(domain)) {
    throw new IntegrationError("Shopify", `"${value ?? ""}" is not a Shopify shop address. It must look like your-store.myshopify.com.`);
  }
  return domain;
}

export const newNonce = () => randomBytes(16).toString("hex");

export const redirectUri = (appUrl: string) => `${appUrl.replace(/\/+$/, "")}${CALLBACK_PATH}`;

/** Where the merchant is sent to approve the scopes. */
export function authorizeUrl(options: {
  shop: string;
  clientId: string;
  appUrl: string;
  state: string;
  scopes?: readonly string[];
}): string {
  const shop = safeShopDomain(options.shop);
  const params = new URLSearchParams({
    client_id: options.clientId,
    scope: (options.scopes ?? DEFAULT_SCOPES).join(","),
    redirect_uri: redirectUri(options.appUrl),
    state: options.state
  });
  // An empty `grant_options[]` asks for an offline token — one that keeps
  // working after the person who approved it has closed the tab. A per-user
  // token would expire and take the nightly sync with it.
  params.append("grant_options[]", "");
  return `https://${shop}/admin/oauth/authorize?${params}`;
}

/**
 * Whether the callback really came from Shopify.
 *
 * Everything but `hmac` and `signature`, sorted by key, joined `k=v` with `&`,
 * signed with the client secret.
 *
 * It is checked against both the decoded and the raw form of the query. The
 * two differ only when a value contains a percent-escape — Shopify's `host`
 * parameter is base64 and sometimes carries one — and the libraries disagree
 * about which is canonical. Accepting either costs nothing in security, because
 * forging either still requires the secret, and it removes a failure that would
 * otherwise strand somebody on a "could not verify" screen with no way forward.
 */
export function verifyCallback(query: URLSearchParams, secret: string): boolean {
  const provided = query.get("hmac") ?? "";
  if (!/^[a-f0-9]{64}$/i.test(provided)) return false;

  const pairs: [string, string][] = [];
  for (const [key, value] of query) {
    if (key === "hmac" || key === "signature") continue;
    pairs.push([key, value]);
  }
  pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const decoded = pairs.map(([key, value]) => `${key}=${value}`).join("&");
  const raw = pairs.map(([key, value]) => `${key}=${encodeURIComponent(value).replace(/%20/g, "+")}`).join("&");

  return matches(decoded, provided, secret) || matches(raw, provided, secret);
}

function matches(message: string, provided: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(message).digest();
  const given = Buffer.from(provided, "hex");
  // Length is checked first because timingSafeEqual throws on a mismatch.
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Trades the one-time code for the offline access token. */
export async function exchangeCode(options: {
  shop: string;
  clientId: string;
  clientSecret: string;
  code: string;
}): Promise<{ accessToken: string; scope: string }> {
  const shop = safeShopDomain(options.shop);

  const { data } = await httpJson<{ access_token?: string; scope?: string }>({
    service: "Shopify",
    url: `https://${shop}/admin/oauth/access_token`,
    method: "POST",
    body: { client_id: options.clientId, client_secret: options.clientSecret, code: options.code }
  });

  if (!data.access_token) {
    throw new IntegrationError("Shopify", "Shopify accepted the request but returned no access token. Check that the app's client secret is the current one — rotating it invalidates the old.");
  }
  return { accessToken: data.access_token, scope: data.scope ?? "" };
}
