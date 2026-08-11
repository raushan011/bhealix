import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { SalesSettings } from "@/models/Sales";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { fail, ok } from "@/lib/api";
import { record } from "@/lib/audit";
import { COMMISSION_BASES } from "@/lib/sales/constants";
import { redirectUri } from "@/lib/sales/oauth";
import { clearShiprocketToken, loadCredentials, storeSecret } from "@/lib/sales/settings";
import { normaliseDomain } from "@/lib/sales/shopify";
import { maskSecret } from "@/lib/sales/secrets";
import { recalculateAll } from "@/lib/sales/sync";
import type { SalesSettingsRecord } from "@/lib/sales/types";

const ruleSchema = z.object({
  suffix: z.string().trim().regex(/^\d{1,3}$/, "A rule's suffix is the digits at the end of a coupon code"),
  label: z.string().trim().min(2).max(60),
  rate: z.number().min(0).max(100),
  base: z.enum(COMMISSION_BASES).default("Discounted lines"),
  products: z.array(z.string().trim().max(120)).max(50).default([]),
  active: z.boolean().default(true)
});

const schema = z.object({
  shopifyDomain: z.string().trim().max(120).optional(),
  shopifyApiVersion: z.string().trim().regex(/^\d{4}-\d{2}$/, "An API version looks like 2026-07").optional(),
  shopifyClientId: z.string().trim().max(120).optional(),
  /** Blank leaves whatever is stored alone — the form never receives the real one back. */
  shopifyClientSecret: z.string().trim().max(200).optional(),
  shopifyAccessToken: z.string().trim().max(200).optional(),
  shiprocketEmail: z.email("Enter the Shiprocket API user's email").optional().or(z.literal("")),
  shiprocketPassword: z.string().trim().max(200).optional(),
  rules: z.array(ruleSchema).max(12).optional(),
  holdDays: z.number().int().min(0).max(90).optional(),
  payoutWeekday: z.number().int().min(0).max(6).optional(),
  backfillDays: z.number().int().min(1).max(730).optional()
});

export async function GET() {
  try {
    const auth = await apiSession(can.viewSales);
    if ("response" in auth) return auth.response;
    await connectDb();

    const settings = await loadCredentials();
    /*
     * The callback address is computed here rather than in the browser.
     *
     * What has to be registered in the Dev Dashboard is the URL the handshake
     * actually sends, and that is built from `NEXT_PUBLIC_APP_URL` on the
     * server. Building it from `window.location` instead would show the right
     * thing on the deployed site and a plausible lie anywhere else — and a
     * redirect URL that is one character out is refused by Shopify with no
     * explanation worth reading.
     */
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

    // The credentials themselves never leave the server. What a form needs is
    // whether one is stored and enough of a hint to recognise it.
    const body: SalesSettingsRecord = {
      callbackUrl: appUrl ? redirectUri(appUrl) : "",
      appUrl,
      shopifyDomain: settings.shopifyDomain,
      shopifyApiVersion: settings.shopifyApiVersion ?? "2026-07",
      shopifyConnectedAt: settings.shopifyConnectedAt?.toISOString(),
      shopifyClientId: settings.shopifyClientId,
      shopifyClientSecretSet: Boolean(settings.shopifyClientSecret),
      shopifyScopes: settings.shopifyScopes,
      shopifyTokenSet: Boolean(settings.shopifyAccessToken),
      shopifyTokenHint: maskSecret(settings.shopifyAccessToken),
      lastOrderSyncAt: settings.lastOrderSyncAt?.toISOString(),
      lastOrderSyncError: settings.lastOrderSyncError,

      shiprocketEmail: settings.shiprocketEmail,
      shiprocketPasswordSet: Boolean(settings.shiprocketPassword),
      lastShipmentSyncAt: settings.lastShipmentSyncAt?.toISOString(),
      lastShipmentSyncError: settings.lastShipmentSyncError,

      rules: settings.rules ?? [],
      holdDays: settings.holdDays ?? 7,
      payoutWeekday: settings.payoutWeekday ?? 1,
      backfillDays: settings.backfillDays ?? 90,
      currency: settings.currency ?? "INR"
    };

    return ok(body);
  } catch (error) {
    return fail(error);
  }
}

export async function PUT(request: Request) {
  try {
    const auth = await apiSession(can.manageSales);
    if ("response" in auth) return auth.response;
    await connectDb();

    const input = schema.parse(await request.json());
    const before = await loadCredentials();

    const set: Record<string, unknown> = {};
    if (input.shopifyDomain !== undefined) set.shopifyDomain = normaliseDomain(input.shopifyDomain);
    if (input.shopifyApiVersion !== undefined) set.shopifyApiVersion = input.shopifyApiVersion;
    if (input.shopifyClientId !== undefined) set.shopifyClientId = input.shopifyClientId || undefined;
    if (input.shiprocketEmail !== undefined) set.shiprocketEmail = input.shiprocketEmail || undefined;
    if (input.rules !== undefined) set.rules = input.rules;
    if (input.holdDays !== undefined) set.holdDays = input.holdDays;
    if (input.payoutWeekday !== undefined) set.payoutWeekday = input.payoutWeekday;
    if (input.backfillDays !== undefined) set.backfillDays = input.backfillDays;

    await SalesSettings.updateOne({ key: "sales" }, { $set: set }, { upsert: true });
    await storeSecret("shopifyAccessToken", input.shopifyAccessToken);
    await storeSecret("shopifyClientSecret", input.shopifyClientSecret);
    await storeSecret("shiprocketPassword", input.shiprocketPassword);

    // A new password invalidates the cached bearer token, which would otherwise
    // keep working for nine days and hide the fact that the new one is wrong.
    if (input.shiprocketPassword || (input.shiprocketEmail && input.shiprocketEmail !== before.shiprocketEmail)) {
      await clearShiprocketToken();
    }

    /*
     * Rates and the hold period are re-applied immediately.
     *
     * Saving a rate change that only takes effect on the next sync is the kind
     * of thing that is discovered a week later, in a payout. Commissions a run
     * has claimed keep their figures — `recalculateCommission` sees to that —
     * so this restates what is still open and nothing else.
     */
    const rulesChanged = input.rules !== undefined && JSON.stringify(input.rules) !== JSON.stringify(before.rules ?? []);
    const holdChanged = input.holdDays !== undefined && input.holdDays !== before.holdDays;
    const recalculated = rulesChanged || holdChanged ? await recalculateAll() : 0;

    await record({
      actor: auth.session.userId,
      action: "sales.settings.updated",
      entityType: "SalesSettings",
      entityId: "sales",
      metadata: { rulesChanged, holdChanged, recalculated }
    });

    return ok({ saved: true, recalculated });
  } catch (error) {
    return fail(error);
  }
}
