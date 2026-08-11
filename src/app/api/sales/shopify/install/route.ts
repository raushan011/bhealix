import { cookies } from "next/headers";
import { connectDb } from "@/lib/db/mongoose";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail } from "@/lib/api";
import { IntegrationError } from "@/lib/sales/http";
import { authorizeUrl, newNonce, OAUTH_STATE_COOKIE } from "@/lib/sales/oauth";
import { loadCredentials } from "@/lib/sales/settings";

/**
 * Step one of connecting Shopify: send the administrator to their own shop to
 * approve the scopes.
 *
 * A plain redirect rather than a JSON endpoint, because the browser has to
 * *travel* to Shopify — this is a link the operator follows, not a call the
 * page makes.
 *
 * The nonce is minted here and kept in an http-only cookie so the callback can
 * prove the round trip started with us. Without it, anybody could hand a signed
 * callback to a signed-in administrator's browser and have a shop of their
 * choosing connected.
 */
export async function GET() {
  try {
    const auth = await apiSession(can.manageSales);
    if ("response" in auth) return auth.response;
    await connectDb();

    const settings = await loadCredentials();
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;

    if (!settings.shopifyDomain) return badRequest("Add your shop address under Sales settings first.");
    if (!settings.shopifyClientId || !settings.shopifyClientSecret) {
      return badRequest("Add the app's Client ID and client secret under Sales settings first. Both come from the app's Settings page in the Shopify Dev Dashboard.");
    }
    if (!appUrl) return badRequest("NEXT_PUBLIC_APP_URL is not configured, so Shopify has nowhere to send the approval back to.");

    const state = newNonce();
    let target: string;
    try {
      target = authorizeUrl({ shop: settings.shopifyDomain, clientId: settings.shopifyClientId, appUrl, state });
    } catch (error) {
      if (error instanceof IntegrationError) return badRequest(error.message);
      throw error;
    }

    (await cookies()).set(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      // Long enough to read an approval screen, short enough that a nonce left
      // in a closed tab is not still valid tomorrow.
      maxAge: 600
    });

    return Response.redirect(target, 302);
  } catch (error) {
    return fail(error);
  }
}

// The session cookie is read on every request, so this can never be static.
export const dynamic = "force-dynamic";
