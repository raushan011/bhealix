import { connectDb } from "@/lib/db/mongoose";
import { SalesSettings } from "@/models/Sales";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { fail, ok } from "@/lib/api";
import { record } from "@/lib/audit";
import { whatsappSettingsSchema } from "@/lib/sales/automation";
import { IntegrationError } from "@/lib/sales/http";
import { loadCredentials, storeSecret, whatsappConfig } from "@/lib/sales/settings";
import { verifyNumber, whatsappMissing } from "@/lib/sales/whatsapp";

/**
 * The Cloud API credentials and the two knobs beside them — the switch and the
 * daily cap. Blank secrets leave what is stored alone, as on the settings
 * screen next door: the form never receives the real token back.
 */
export async function PUT(request: Request) {
  try {
    const auth = await apiSession(can.manageSales);
    if ("response" in auth) return auth.response;
    await connectDb();

    const input = whatsappSettingsSchema.parse(await request.json());
    const set: Record<string, unknown> = {};
    const unset: Record<string, string> = {};

    if (input.phoneNumberId !== undefined) set.whatsappPhoneNumberId = input.phoneNumberId || undefined;
    if (input.businessAccountId !== undefined) set.whatsappBusinessAccountId = input.businessAccountId || undefined;
    if (input.verifyToken !== undefined) set.whatsappVerifyToken = input.verifyToken || undefined;
    if (input.apiVersion !== undefined) set.whatsappApiVersion = input.apiVersion;
    if (input.autoSend !== undefined) set.whatsappAutoSend = input.autoSend;
    if (input.dailyCap !== undefined) set.whatsappDailyCap = input.dailyCap;

    // New credentials mean the last test no longer says anything about them.
    if (input.phoneNumberId !== undefined || input.accessToken) {
      unset.whatsappConnectedAt = "";
      unset.whatsappDisplayNumber = "";
      unset.lastWhatsappError = "";
    }

    await SalesSettings.updateOne({ key: "sales" }, {
      ...(Object.keys(set).length ? { $set: set } : {}),
      ...(Object.keys(unset).length ? { $unset: unset } : {})
    }, { upsert: true });
    await storeSecret("whatsappAccessToken", input.accessToken);
    await storeSecret("whatsappAppSecret", input.appSecret);

    await record({
      actor: auth.session.userId,
      action: "sales.automation.settings.updated",
      entityType: "SalesSettings",
      entityId: "sales",
      metadata: {
        autoSend: input.autoSend,
        dailyCap: input.dailyCap,
        tokenChanged: Boolean(input.accessToken),
        appSecretChanged: Boolean(input.appSecret)
      }
    });

    return ok({ saved: true });
  } catch (error) {
    return fail(error);
  }
}

/**
 * "Test connection". As on the settings screen, a bad credential is a 200
 * saying so — the request itself was fine.
 */
export async function POST() {
  try {
    const auth = await apiSession(can.manageSales);
    if ("response" in auth) return auth.response;
    await connectDb();

    const settings = await loadCredentials();
    const config = whatsappConfig(settings);
    if (!config) {
      return ok({
        ok: false,
        message: whatsappMissing({
          phoneNumberId: settings.whatsappPhoneNumberId,
          businessAccountId: settings.whatsappBusinessAccountId,
          accessToken: settings.whatsappAccessToken
        })
      });
    }

    try {
      const number = await verifyNumber(config);
      await SalesSettings.updateOne({ key: "sales" }, {
        $set: { whatsappConnectedAt: new Date(), whatsappDisplayNumber: number.displayNumber },
        $unset: { lastWhatsappError: "" }
      });
      const tier = number.tier ? ` Meta's sending limit for this number is ${describeTier(number.tier)}.` : "";
      return ok({
        ok: true,
        message: `Connected to ${number.displayNumber}${number.name ? ` (${number.name})` : ""}. Quality rating: ${number.quality}.${tier}`,
        displayNumber: number.displayNumber
      });
    } catch (error) {
      const message = error instanceof IntegrationError ? error.message : error instanceof Error ? error.message : "Could not reach WhatsApp.";
      await SalesSettings.updateOne({ key: "sales" }, { $set: { lastWhatsappError: message } });
      return ok({ ok: false, message });
    }
  } catch (error) {
    return fail(error);
  }
}

/** Meta's tier names, in numbers a person can set the cap by. */
function describeTier(tier: string): string {
  switch (tier) {
    case "TIER_50": return "50 new conversations a day (unverified business)";
    case "TIER_250": return "250 new conversations a day";
    case "TIER_1K": return "1,000 new conversations a day";
    case "TIER_10K": return "10,000 new conversations a day";
    case "TIER_100K": return "100,000 new conversations a day";
    case "TIER_UNLIMITED": return "unlimited";
    default: return tier;
  }
}
