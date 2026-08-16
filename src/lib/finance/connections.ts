import { Types } from "mongoose";
import { FinanceConnection } from "@/models/Finance";
/*
 * The affiliate feature's encryption, reused rather than reimplemented.
 *
 * It is named for `lib/sales` only because that is where the first credential
 * needing it happened to live; nothing in it knows anything about affiliates.
 * It derives a key from `AUTH_SECRET` and does AES-256-GCM, which is exactly
 * what is wanted here — and a second copy of the same twenty lines would be a
 * second thing to get wrong, and a second format to migrate.
 */
import { decryptSecret, encryptSecret, maskSecret } from "@/lib/sales/secrets";
import { connectorFor } from "./connectors";
import type { Credentials } from "./connectors/types";
import type { ConnectorKey } from "./sources";

/**
 * Reading and writing a vendor's API key.
 *
 * Two ways in, and the difference is the point. `describeConnection` is what the
 * settings screen uses: it never asks for the secrets, so a page that wants to
 * say "connected" cannot accidentally serialise a Razorpay secret into its own
 * HTML. `loadCredentials` asks for them explicitly, decrypts them, and is called
 * only by a test or a fetch. The same arrangement `lib/sales/settings` uses next
 * door, and for the same reason.
 */

type ConnectionDoc = {
  connector?: string;
  publicFields?: Map<string, string> | Record<string, string>;
  secrets?: Map<string, string> | Record<string, string>;
  lastTestedAt?: Date;
  lastTestOk?: boolean;
  lastTestMessage?: string;
  lastFetchedAt?: Date;
  lastFetchError?: string;
};

/** A Mongoose `Map` read through `.lean()` is sometimes a Map and sometimes not. */
const asRecord = (value: ConnectionDoc["publicFields"]): Record<string, string> => {
  if (!value) return {};
  return value instanceof Map ? Object.fromEntries(value) : { ...value };
};

/** What the settings screen is told: the visible fields, and which secrets exist. */
export type ConnectionSummary = {
  connector: ConnectorKey;
  label: string;
  consoleUrl: string;
  guidance: string;
  fields: { name: string; label: string; secret: boolean; placeholder?: string; hint?: string; required: boolean }[];
  /** Only the non-secret values. A secret is never sent back, ever. */
  values: Record<string, string>;
  /** `keySecret: "••••••••3f9a"` — enough to recognise, useless to anybody else. */
  hints: Record<string, string>;
  configured: boolean;
  lastTestedAt?: string;
  lastTestOk?: boolean;
  lastTestMessage?: string;
  lastFetchedAt?: string;
  lastFetchError?: string;
};

/**
 * The whole set, in the registry's order, whether or not anything is stored.
 *
 * `+secrets` even though not one of them leaves this function. The hint a form
 * shows — `••••••••1234` — is the last four characters of the *plaintext*, so it
 * cannot be built without decrypting the stored value, and `configured` cannot
 * be answered without knowing whether a secret is there at all. Both are derived
 * here and the plaintext is discarded on the same line; what the caller receives
 * carries the mask and nothing else. Forgetting this select is why the screen
 * first reported a stored key as missing.
 */
export async function describeConnections(): Promise<ConnectionSummary[]> {
  const stored = await FinanceConnection.find().select("+secrets").lean() as ConnectionDoc[];
  const byKey = new Map(stored.map(row => [row.connector, row]));

  const { ALL_CONNECTORS } = await import("./connectors");
  return ALL_CONNECTORS.map(connector => {
    const row = byKey.get(connector.key);
    const values = asRecord(row?.publicFields);
    /*
     * A hint has to come from the *encrypted* value's last characters, which
     * means decrypting it — so the hint is built here rather than stored. The
     * plaintext is discarded on the next line and never leaves this function.
     */
    const secrets = asRecord(row?.secrets);
    const hints: Record<string, string> = {};
    for (const field of connector.fields) {
      if (field.secret && secrets[field.name]) hints[field.name] = maskSecret(decryptSecret(secrets[field.name]));
    }

    return {
      connector: connector.key,
      label: connector.label,
      consoleUrl: connector.consoleUrl,
      guidance: connector.guidance,
      fields: connector.fields.map(field => ({ ...field })),
      values,
      hints,
      configured: connector.fields.every(field =>
        !field.required || Boolean(field.secret ? secrets[field.name] : values[field.name])),
      lastTestedAt: row?.lastTestedAt?.toISOString(),
      lastTestOk: row?.lastTestOk,
      lastTestMessage: row?.lastTestMessage,
      lastFetchedAt: row?.lastFetchedAt?.toISOString(),
      lastFetchError: row?.lastFetchError
    };
  });
}

/**
 * The credentials themselves, decrypted. Server only, and only for a test or a
 * fetch.
 *
 * Returns null when a required field is missing, so a caller cannot make a
 * request with half a credential and get back a refusal it has to interpret.
 */
export async function loadCredentials(key: ConnectorKey): Promise<Credentials | null> {
  const row = await FinanceConnection.findOne({ connector: key })
    .select("+secrets").lean() as ConnectionDoc | null;
  if (!row) return null;

  const publicFields = asRecord(row.publicFields);
  const secrets = asRecord(row.secrets);

  const credentials: Credentials = {};
  for (const field of connectorFor(key).fields) {
    const value = field.secret ? decryptSecret(secrets[field.name]) : publicFields[field.name] ?? "";
    if (!value && field.required) return null;
    credentials[field.name] = value;
  }
  return credentials;
}

/**
 * Saves what was typed.
 *
 * A blank secret leaves whatever is stored alone, which is what makes the form
 * usable at all: it never receives the real value back, so "save" on an
 * unchanged form would otherwise wipe the key. A visible field *is* cleared by
 * a blank, because that one round-trips and blanking it is a real instruction.
 */
export async function storeCredentials(key: ConnectorKey, input: Credentials, actor: string) {
  const connector = connectorFor(key);
  const set: Record<string, unknown> = { connector: key, updatedBy: new Types.ObjectId(actor) };

  for (const field of connector.fields) {
    const value = (input[field.name] ?? "").trim();
    if (field.secret) {
      if (value) set[`secrets.${field.name}`] = encryptSecret(value);
    } else {
      set[`publicFields.${field.name}`] = value;
    }
  }

  await FinanceConnection.updateOne({ connector: key }, { $set: set }, { upsert: true });
}

/** Forgets a vendor's key entirely. */
export async function clearCredentials(key: ConnectorKey) {
  await FinanceConnection.deleteOne({ connector: key });
}

/** Records what a test said, so the screen can show it without testing again. */
export async function recordTest(key: ConnectorKey, ok: boolean, message: string) {
  await FinanceConnection.updateOne(
    { connector: key },
    { $set: { connector: key, lastTestedAt: new Date(), lastTestOk: ok, lastTestMessage: message.slice(0, 300) } },
    { upsert: true }
  );
}

/** And what a fetch said, so a month that failed overnight is visible in the morning. */
export async function recordFetch(key: ConnectorKey, error?: string) {
  await FinanceConnection.updateOne(
    { connector: key },
    { $set: { connector: key, lastFetchedAt: new Date(), lastFetchError: error?.slice(0, 300) ?? "" } },
    { upsert: true }
  );
}
