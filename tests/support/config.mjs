/**
 * One place that decides what the tests are pointed at.
 *
 * Everything here is read from the environment so the same suite can be run
 * against a local build, a staging deployment or — deliberately, never by
 * accident — production. The safety check at the bottom is the part that
 * matters: this repository's `.env.local` points at a live Atlas cluster, so
 * the default of "just run it" would otherwise mean "write load-test junk into
 * the real CRM".
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");

/**
 * Reads a value out of the env files the way Next.js and scripts/seed.mjs do,
 * so the tests see the same configuration the app does without a separate
 * dotenv dependency. `.env.test` wins, because that is the file whose whole
 * purpose is to override the developer's own settings.
 */
function readEnv(key) {
  if (process.env[key]) return process.env[key];
  for (const file of [".env.test", ".env.local", ".env"]) {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) continue;
    const line = fs.readFileSync(full, "utf8").split(/\r?\n/)
      .find(row => !row.trimStart().startsWith("#") && row.trimStart().startsWith(`${key}=`));
    if (line) return line.trimStart().slice(key.length + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return undefined;
}

export const BASE_URL = (readEnv("TEST_BASE_URL") ?? "http://127.0.0.1:3000").replace(/\/$/, "");

/**
 * The database the tests are allowed to touch.
 *
 * Defaults to the app's own connection string with the database name swapped
 * for `bhealix_crm_test`. Same cluster, same credentials, different database —
 * which is what makes seeding and truncating safe.
 */
export const TEST_DB_URI = (() => {
  const explicit = readEnv("TEST_MONGODB_URI");
  if (explicit) return explicit;
  const source = readEnv("MONGODB_URI");
  if (!source) throw new Error("Neither TEST_MONGODB_URI nor MONGODB_URI is set");
  // Swap only the path segment, leaving the query string (retryWrites, appName…) alone.
  return source.replace(/\/([^/?]+)(\?|$)/, "/bhealix_crm_test$2");
})();

export const AUTH_SECRET = readEnv("AUTH_SECRET");

/** The password every seeded test account shares. Never a real one. */
export const TEST_PASSWORD = readEnv("TEST_PASSWORD") ?? "TestOnly@12345";

/** Accounts the seeder creates, one per role, so RBAC can be checked as a matrix. */
export const ACCOUNTS = {
  ADMIN: { employeeId: "TEST-ADMIN", email: "test-admin@bhealix.test", name: "Test Admin", role: "ADMIN" },
  HR: { employeeId: "TEST-HR", email: "test-hr@bhealix.test", name: "Test HR", role: "HR" },
  MR: { employeeId: "TEST-MR", email: "test-mr@bhealix.test", name: "Test MR", role: "MR" },
  /** A second field account, so "can one rep read another rep's data?" is answerable. */
  MR2: { employeeId: "TEST-MR2", email: "test-mr2@bhealix.test", name: "Test MR Two", role: "MR" },
  SALES: { employeeId: "TEST-SALES", email: "test-sales@bhealix.test", name: "Test Sales", role: "SALES" }
};

/** Every seeded record carries this, so cleanup can find its own litter and nothing else. */
export const TEST_MARKER = "__bhealix_test__";

// --------------------------------------------------------------- safety net

const PRODUCTION_DB = /\/bhealix_crm(\?|$)/;
const LOCAL_HOST = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/;

/**
 * Refuses to run against anything that looks live unless somebody said so.
 *
 * Load and stress tests exist to find the point where a system falls over, and
 * the security tests deliberately attempt access-control bypasses. Both are
 * fine against a throwaway database and indefensible against the one the reps
 * are using. `ALLOW_PRODUCTION=1` is the deliberate act; there is no way to
 * arrive here by forgetting something.
 */
export function assertSafeTarget({ destructive = true } = {}) {
  if (process.env.ALLOW_PRODUCTION === "1") {
    console.warn("\n  ⚠  ALLOW_PRODUCTION=1 — running against a live target on purpose.\n");
    return;
  }
  if (!destructive) return;

  if (PRODUCTION_DB.test(TEST_DB_URI)) {
    throw new Error(
      `Refusing to run: the test database resolves to the production database.\n` +
      `  Resolved to: ${TEST_DB_URI.replace(/\/\/[^@]+@/, "//***@")}\n` +
      `  Set TEST_MONGODB_URI to a database ending in _test, or ALLOW_PRODUCTION=1 to override.`
    );
  }
  if (!LOCAL_HOST.test(BASE_URL)) {
    throw new Error(
      `Refusing to run: ${BASE_URL} is not a local target.\n` +
      `  Set ALLOW_PRODUCTION=1 if you intend to test a deployed environment.`
    );
  }
}
