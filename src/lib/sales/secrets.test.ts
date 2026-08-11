import { beforeAll, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, maskSecret } from "./secrets";

/** The key is derived from this, so it has to exist before anything is encrypted. */
beforeAll(() => { process.env.AUTH_SECRET = "test-secret-at-least-thirty-two-characters"; });

const TOKEN = "shpat_a1b2c3d4e5f6g7h8i9j0";
/** Invented, but shaped like a generated one — punctuation is the point of the case below. */
const PASSWORD = "xQ@$!4@w%TtLwRkpN!ruz*Nb7pqm2Rbw";

describe("encryptSecret / decryptSecret", () => {
  it("returns what was put in", () => {
    expect(decryptSecret(encryptSecret(TOKEN))).toBe(TOKEN);
  });

  it("survives the punctuation a generated password is full of", () => {
    // The stored form is dot-separated, and a password containing dots, dollars
    // and percent signs must not disturb that.
    expect(decryptSecret(encryptSecret(PASSWORD))).toBe(PASSWORD);
    expect(decryptSecret(encryptSecret("a.b.c.d.e"))).toBe("a.b.c.d.e");
  });

  it("is parsed from the end, because the prefix carries a dot of its own", () => {
    // The regression this file exists for. `enc.v1` splits into two pieces, so
    // a stored value has six parts and not five; reading the salt as part one
    // read the version string instead, every decryption failed silently, and
    // the settings screen told somebody who had just saved a password that
    // there was no password.
    const stored = encryptSecret(TOKEN);
    expect(stored.startsWith("enc.v1.")).toBe(true);
    expect(stored.split(".")).toHaveLength(6);
    expect(decryptSecret(stored)).toBe(TOKEN);
  });

  it("never leaves the plaintext lying in the stored value", () => {
    expect(encryptSecret(TOKEN)).not.toContain(TOKEN);
    expect(encryptSecret(TOKEN)).not.toContain("shpat_");
  });

  it("encrypts the same value differently every time", () => {
    // A fresh salt and iv per write, so two accounts sharing a password do not
    // share a ciphertext.
    expect(encryptSecret(TOKEN)).not.toBe(encryptSecret(TOKEN));
  });

  it("passes through a value that was never encrypted", () => {
    // A credential typed straight into the database during setup still works.
    expect(decryptSecret("shpat_plain")).toBe("shpat_plain");
  });

  it("is empty rather than throwing when it cannot be read", () => {
    // What a rotated AUTH_SECRET looks like: the screen says "not connected".
    expect(decryptSecret("enc.v1.not.real.base64.data")).toBe("");
    expect(decryptSecret("")).toBe("");
    expect(decryptSecret(null)).toBe("");
    expect(decryptSecret(undefined)).toBe("");
  });

  it("encrypts nothing to nothing", () => {
    expect(encryptSecret("")).toBe("");
  });
});

describe("maskSecret", () => {
  it("shows just enough of a credential to recognise it", () => {
    expect(maskSecret(TOKEN)).toBe("••••••••i9j0");
    expect(maskSecret("")).toBe("");
    expect(maskSecret(undefined)).toBe("");
  });
});
