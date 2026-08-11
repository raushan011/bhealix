import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/**
 * Encryption at rest for the two credentials this feature has to keep: a
 * Shopify Admin API token and a Shiprocket password.
 *
 * Neither can be hashed — unlike a user's password, they have to be *presented*
 * to somebody else's API, so the plaintext must be recoverable. That leaves
 * encryption, and the honest reason to bother is blast radius: a Shopify admin
 * token reads every order and every customer this company has, and a database
 * dump should not hand that over in plain sight.
 *
 * The key is derived from `AUTH_SECRET`, which already exists, is already
 * required to be long, and is already the thing whose leak compromises the
 * application. Rotating it invalidates the stored credentials, which is the
 * correct behaviour: they are re-entered on the settings screen.
 *
 * Server only — `node:crypto` and the secret both belong there.
 */

const PREFIX = "enc.v1";

const keyFor = (salt: Buffer) => {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not configured");
  return scryptSync(secret, salt, 32);
};

/** `enc.v1.<salt>.<iv>.<tag>.<ciphertext>`, all base64url. */
export function encryptSecret(value: string): string {
  if (!value) return "";
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFor(salt), iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [PREFIX, salt, iv, cipher.getAuthTag(), body].map(part => typeof part === "string" ? part : part.toString("base64url")).join(".");
}

/**
 * Reads one back. A value that was never encrypted is returned as it stands, so
 * a credential typed straight into the database during setup still works — and
 * a value that cannot be decrypted returns empty rather than throwing, because
 * a rotated `AUTH_SECRET` should show "not connected" on the settings screen,
 * not a stack trace on every page that reads the settings.
 */
export function decryptSecret(stored: string | null | undefined): string {
  if (!stored) return "";
  if (!stored.startsWith(`${PREFIX}.`)) return stored;

  try {
    /*
     * The **last four** parts, not parts one to four.
     *
     * `PREFIX` is "enc.v1" and contains a dot of its own, so a stored value
     * splits into six pieces rather than five. Counting from the front read the
     * version as the salt, every decryption failed, and — because a failure
     * returns empty by design — the settings screen reported "no credential
     * stored" to somebody who had just stored one. Counting from the back is
     * right whatever the prefix is ever changed to.
     */
    const [salt, iv, tag, body] = stored.split(".").slice(-4);
    const decipher = createDecipheriv("aes-256-gcm", keyFor(Buffer.from(salt, "base64url")), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
  } catch (error) {
    // Still swallowed: a rotated AUTH_SECRET should show "not connected" rather
    // than a stack trace on every page that reads the settings. But it is
    // logged now — the silence is what made the bug above hard to see.
    console.error("Could not decrypt a stored credential", error);
    return "";
  }
}

/**
 * What a credential looks like on screen. Never the value itself: the settings
 * form shows that something is stored and lets it be replaced, which is all
 * anybody needs and all anybody should be shown.
 */
export const maskSecret = (value: string | null | undefined) =>
  value ? `••••••••${value.slice(-4)}` : "";
