import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { SalesSettings } from "@/models/Sales";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { fail, ok } from "@/lib/api";
import { IntegrationError } from "@/lib/sales/http";
import { loadCredentials, shiprocketConfig, shopifyConfig } from "@/lib/sales/settings";
import { login } from "@/lib/sales/shiprocket";
import { verifyShop } from "@/lib/sales/shopify";

const schema = z.object({ service: z.enum(["shopify", "shiprocket"]) });

/**
 * "Test connection" — the button that answers the only question anybody has
 * while setting this up.
 *
 * Deliberately never a 4xx for a *failed* credential: the request itself was
 * fine, and the answer to "does this token work" is a 200 saying no, with the
 * reason on it. Reserving errors for a broken request keeps the form's own
 * error handling honest.
 */
export async function POST(request: Request) {
  try {
    const auth = await apiSession(can.manageSales);
    if ("response" in auth) return auth.response;
    await connectDb();

    const { service } = schema.parse(await request.json());
    const settings = await loadCredentials();

    if (service === "shopify") {
      const config = shopifyConfig(settings);
      if (!config) {
        /*
         * Which of three things is missing decides what to say. The token is no
         * longer something anybody types — it is issued by the approval round
         * trip — so telling somebody to "add the access token" when they are
         * one button away from earning one is an instruction they cannot follow.
         */
        const message = !settings.shopifyDomain
          ? "Add your shop address first. It looks like your-store.myshopify.com — pasting your Shopify admin URL works too."
          : settings.shopifyClientId && settings.shopifyClientSecret
            ? "The app is not authorised yet. Press Connect with Shopify: Shopify asks you to approve the scopes, and the access token is issued from that. Come back and test once it returns."
            : "Add the app's Client ID and client secret from the Dev Dashboard, then press Connect with Shopify.";
        return ok({ ok: false, message });
      }

      try {
        const shop = await verifyShop(config);
        await SalesSettings.updateOne({ key: "sales" }, { $set: { shopifyConnectedAt: new Date(), currency: shop.currency }, $unset: { lastOrderSyncError: "" } });
        return ok({ ok: true, message: `Connected to ${shop.name} (${shop.domain}).`, currency: shop.currency });
      } catch (error) {
        return ok({ ok: false, message: messageFor(error, "Shopify") });
      }
    }

    const config = shiprocketConfig(settings);
    if (!config) return ok({ ok: false, message: "Add the Shiprocket API user's email and password first." });

    try {
      const { token, expiresAt } = await login(config);
      const { encryptSecret } = await import("@/lib/sales/secrets");
      await SalesSettings.updateOne({ key: "sales" }, {
        $set: { shiprocketToken: encryptSecret(token), shiprocketTokenExpiresAt: expiresAt },
        $unset: { lastShipmentSyncError: "" }
      });
      return ok({ ok: true, message: "Connected to Shiprocket. The token lasts ten days and is refreshed automatically." });
    } catch (error) {
      return ok({ ok: false, message: messageFor(error, "Shiprocket") });
    }
  } catch (error) {
    return fail(error);
  }
}

const messageFor = (error: unknown, service: string) =>
  error instanceof IntegrationError ? error.message
    : error instanceof Error ? error.message
    : `Could not reach ${service}.`;
