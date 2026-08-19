import { connectDb } from "@/lib/db/mongoose";
import { SalesAutomationRule } from "@/models/Sales";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { fail, ok } from "@/lib/api";
import { DEFAULT_DAILY_CAP, WEBHOOK_PATH } from "@/lib/sales/automation";
import { automationCounts, countMatching, ruleStats } from "@/lib/sales/outreach-engine";
import { loadCredentials, whatsappConfig } from "@/lib/sales/settings";
import { maskSecret } from "@/lib/sales/secrets";
import { DEFAULT_GRAPH_VERSION } from "@/lib/sales/whatsapp";
import type { AutomationOverview } from "@/lib/sales/types";

type RuleDoc = {
  _id: unknown;
  name: string;
  enabled: boolean;
  leadType?: string;
  city?: string;
  freshOnly?: boolean;
  template: { name: string; language: string; body?: string; fields?: string[] };
  createdAt?: Date;
  updatedAt?: Date;
};

/**
 * Everything the automation panel shows on first paint: whether WhatsApp is
 * connected, the switch, the cap, every rule with its figures, and the counts
 * across the top. One request, because the panel is a dashboard and a dashboard
 * that assembles itself from six calls flickers.
 */
export async function GET() {
  try {
    const auth = await apiSession(can.viewSales);
    if ("response" in auth) return auth.response;
    await connectDb();

    const settings = await loadCredentials();
    const [rules, stats, counts] = await Promise.all([
      SalesAutomationRule.find().sort({ createdAt: 1 }).lean() as unknown as Promise<RuleDoc[]>,
      ruleStats(),
      automationCounts()
    ]);

    const matching = await Promise.all(rules.map(rule => countMatching(rule)));
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");

    const body: AutomationOverview = {
      connected: Boolean(whatsappConfig(settings)),
      autoSend: Boolean(settings.whatsappAutoSend),
      dailyCap: settings.whatsappDailyCap ?? DEFAULT_DAILY_CAP,
      phoneNumberId: settings.whatsappPhoneNumberId ?? "",
      businessAccountId: settings.whatsappBusinessAccountId ?? "",
      apiVersion: settings.whatsappApiVersion || DEFAULT_GRAPH_VERSION,
      accessTokenSet: Boolean(settings.whatsappAccessToken),
      accessTokenHint: maskSecret(settings.whatsappAccessToken),
      appSecretSet: Boolean(settings.whatsappAppSecret),
      verifyToken: settings.whatsappVerifyToken ?? "",
      displayNumber: settings.whatsappDisplayNumber ?? "",
      connectedAt: settings.whatsappConnectedAt?.toISOString(),
      lastError: settings.lastWhatsappError,
      webhookUrl: appUrl ? `${appUrl}${WEBHOOK_PATH}` : WEBHOOK_PATH,
      mayEdit: can.manageSales(auth.session.role),
      counts,
      rules: rules.map((rule, index) => ({
        _id: String(rule._id),
        name: rule.name,
        enabled: rule.enabled,
        leadType: rule.leadType ?? "",
        city: rule.city ?? "",
        freshOnly: rule.freshOnly !== false,
        template: {
          name: rule.template.name,
          language: rule.template.language,
          body: rule.template.body ?? "",
          fields: rule.template.fields ?? []
        },
        stats: stats[String(rule._id)] ?? { queued: 0, sent: 0, replied: 0, failed: 0 },
        matching: matching[index],
        createdAt: rule.createdAt?.toISOString(),
        updatedAt: rule.updatedAt?.toISOString()
      }))
    };

    return ok(body);
  } catch (error) {
    return fail(error);
  }
}
