import { SalesSettings } from "@/models/Sales";
import type { CommissionRule } from "./commission";
import { DEFAULT_BACKFILL_DAYS, DEFAULT_HOLD_DAYS } from "./constants";
import { decryptSecret, encryptSecret } from "./secrets";
import { login as shiprocketLogin, type ShiprocketConfig } from "./shiprocket";
import { normaliseDomain, type ShopifyConfig } from "./shopify";

/**
 * The affiliate settings document, and the credentials inside it.
 *
 * Two ways in, and the difference matters. `loadSettings()` is what every screen
 * and every route uses: it never asks for the secrets, so a page that wants a
 * commission rate cannot accidentally serialise a Shopify admin token into its
 * own HTML. `loadCredentials()` asks for them explicitly, decrypts them, and is
 * called only by the sync.
 */

type SettingsDoc = {
  _id?: unknown;
  shopifyDomain?: string;
  shopifyClientId?: string;
  shopifyClientSecret?: string;
  shopifyAccessToken?: string;
  shopifyScopes?: string;
  shopifyApiVersion?: string;
  shopifyConnectedAt?: Date;
  lastOrderSyncAt?: Date;
  lastOrderSyncError?: string;
  shiprocketEmail?: string;
  shiprocketPassword?: string;
  shiprocketToken?: string;
  shiprocketTokenExpiresAt?: Date;
  lastShipmentSyncAt?: Date;
  lastShipmentSyncError?: string;
  rules?: CommissionRule[];
  holdDays?: number;
  payoutWeekday?: number;
  backfillDays?: number;
  currency?: string;
};

/**
 * The singleton, created on first read so no screen ever has to handle an empty
 * state — the same idiom as the billing and payroll settings (§4.11).
 */
export async function loadSettings(): Promise<SettingsDoc> {
  return await SalesSettings.findOneAndUpdate(
    { key: "sales" },
    { $setOnInsert: { key: "sales" } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean() as SettingsDoc;
}

/** The same document with the two secrets decrypted. Server only, sync only. */
export async function loadCredentials(): Promise<SettingsDoc> {
  await loadSettings();
  const doc = await SalesSettings.findOne({ key: "sales" })
    .select("+shopifyAccessToken +shopifyClientSecret +shiprocketPassword +shiprocketToken")
    .lean() as SettingsDoc;

  return {
    ...doc,
    shopifyAccessToken: decryptSecret(doc?.shopifyAccessToken),
    shopifyClientSecret: decryptSecret(doc?.shopifyClientSecret),
    shiprocketPassword: decryptSecret(doc?.shiprocketPassword),
    shiprocketToken: decryptSecret(doc?.shiprocketToken)
  };
}

export const holdDaysOf = (settings: SettingsDoc) => settings.holdDays ?? DEFAULT_HOLD_DAYS;
export const backfillDaysOf = (settings: SettingsDoc) => settings.backfillDays ?? DEFAULT_BACKFILL_DAYS;
export const rulesOf = (settings: SettingsDoc): CommissionRule[] => settings.rules ?? [];

type SecretField = "shopifyAccessToken" | "shopifyClientSecret" | "shiprocketPassword";

/** Writes a secret back encrypted; an empty value leaves what is already stored alone. */
export async function storeSecret(field: SecretField, value: string | undefined) {
  if (!value) return;
  await SalesSettings.updateOne({ key: "sales" }, { $set: { [field]: encryptSecret(value) } });
}

export function shopifyConfig(settings: SettingsDoc): ShopifyConfig | null {
  const domain = normaliseDomain(settings.shopifyDomain ?? "");
  if (!domain || !settings.shopifyAccessToken) return null;
  return { domain, accessToken: settings.shopifyAccessToken, apiVersion: settings.shopifyApiVersion || "2026-07" };
}

export const shiprocketConfig = (settings: SettingsDoc): ShiprocketConfig | null =>
  settings.shiprocketEmail && settings.shiprocketPassword
    ? { email: settings.shiprocketEmail, password: settings.shiprocketPassword }
    : null;

/**
 * A usable Shiprocket bearer token, logging in only when the cached one has run
 * out. The refreshed token is written back encrypted, so a run of syncs costs
 * one login every nine days rather than one login each.
 */
export async function shiprocketToken(settings: SettingsDoc): Promise<string | null> {
  const config = shiprocketConfig(settings);
  if (!config) return null;

  const cached = settings.shiprocketToken;
  const expires = settings.shiprocketTokenExpiresAt ? new Date(settings.shiprocketTokenExpiresAt) : null;
  if (cached && expires && expires > new Date()) return cached;

  const fresh = await shiprocketLogin(config);
  await SalesSettings.updateOne({ key: "sales" }, {
    $set: { shiprocketToken: encryptSecret(fresh.token), shiprocketTokenExpiresAt: fresh.expiresAt }
  });
  return fresh.token;
}

/** Forgets the cached token, so the next sync logs in again. */
export async function clearShiprocketToken() {
  await SalesSettings.updateOne({ key: "sales" }, { $unset: { shiprocketToken: "", shiprocketTokenExpiresAt: "" } });
}
