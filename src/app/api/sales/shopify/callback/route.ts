import { cookies } from "next/headers";
import { timingSafeEqual } from "node:crypto";
import { connectDb } from "@/lib/db/mongoose";
import { SalesSettings } from "@/models/Sales";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { fail } from "@/lib/api";
import { record } from "@/lib/audit";
import { IntegrationError } from "@/lib/sales/http";
import { exchangeCode, OAUTH_STATE_COOKIE, safeShopDomain, verifyCallback } from "@/lib/sales/oauth";
import { encryptSecret } from "@/lib/sales/secrets";
import { loadCredentials } from "@/lib/sales/settings";

/**
 * Step two: Shopify sends the merchant back with a one-time code.
 *
 * Three checks before that code is worth anything, and none of them is
 * optional:
 *
 * 1. **The nonce** we issued must come back, matched in constant time. This is
 *    what proves the round trip started on our settings screen rather than in
 *    somebody else's page.
 * 2. **The HMAC** must verify against the client secret, which proves Shopify
 *    sent it and that no parameter was altered on the way.
 * 3. **The shop** must be a real `.myshopify.com` address, checked before it is
 *    ever put into a URL — the code is exchanged by posting the client secret
 *    to that host, and a crafted value would post it somewhere else.
 *
 * Failure ends on the settings screen with a message, never a bare error page:
 * whoever is here is halfway through connecting something and needs to know
 * which half went wrong.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = (message: string, ok = false) =>
    Response.redirect(new URL(`/admin/sales/settings?shopify=${ok ? "connected" : "failed"}&message=${encodeURIComponent(message)}`, url.origin), 302);

  try {
    const auth = await apiSession(can.manageSales);
    if ("response" in auth) return auth.response;
    await connectDb();

    const jar = await cookies();
    const expected = jar.get(OAUTH_STATE_COOKIE)?.value ?? "";
    const state = url.searchParams.get("state") ?? "";
    jar.delete(OAUTH_STATE_COOKIE);

    if (!expected || !sameNonce(expected, state)) {
      return back("That approval did not match the one this screen started. Press Connect with Shopify again.");
    }

    const settings = await loadCredentials();
    if (!settings.shopifyClientId || !settings.shopifyClientSecret) {
      return back("The app's Client ID and secret are no longer stored. Add them and try again.");
    }

    if (!verifyCallback(url.searchParams, settings.shopifyClientSecret)) {
      return back("Shopify's signature on that reply did not verify. The client secret stored here is probably not the current one — rotating it in the Dev Dashboard invalidates the old.");
    }

    let shop: string;
    try {
      shop = safeShopDomain(url.searchParams.get("shop"));
    } catch (error) {
      return back(error instanceof IntegrationError ? error.message : "That reply named a shop this could not read.");
    }

    const code = url.searchParams.get("code") ?? "";
    if (!code) return back("Shopify sent no authorisation code back.");

    const { accessToken, scope } = await exchangeCode({
      shop, code,
      clientId: settings.shopifyClientId,
      clientSecret: settings.shopifyClientSecret
    });

    await SalesSettings.updateOne({ key: "sales" }, {
      $set: {
        shopifyDomain: shop,
        shopifyAccessToken: encryptSecret(accessToken),
        shopifyScopes: scope,
        shopifyConnectedAt: new Date()
      },
      $unset: { lastOrderSyncError: "" }
    });

    await record({
      actor: auth.session.userId,
      action: "sales.settings.updated",
      entityType: "SalesSettings",
      entityId: "sales",
      metadata: { connected: "shopify", shop, scope }
    });

    // Scopes are reported rather than assumed: Shopify grants what the app is
    // configured for, which is not always what was asked for, and an order sync
    // that silently reads nothing is the failure this prevents.
    const granted = scope.split(",").filter(Boolean);
    const missing = ["read_orders", "read_products"].filter(needed => !granted.includes(needed));

    return back(missing.length
      ? `Connected to ${shop}, but Shopify did not grant ${missing.join(" or ")}. Add ${missing.length === 1 ? "that scope" : "those scopes"} to the app in the Dev Dashboard, release a version, then connect again.`
      : `Connected to ${shop}.`, !missing.length);
  } catch (error) {
    if (error instanceof IntegrationError) return back(error.message);
    return fail(error);
  }
}

/** Constant-time, and length-checked first because `timingSafeEqual` throws on a mismatch. */
function sameNonce(expected: string, given: string): boolean {
  const a = Buffer.from(expected), b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const dynamic = "force-dynamic";
