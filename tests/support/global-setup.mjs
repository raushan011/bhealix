/**
 * Runs once before the integration and security suites.
 *
 * Checks the target is safe, waits for the server, seeds the database, and
 * leaves the created ids where the test files can read them — a test needing
 * "a doctor assigned to the other rep" should be handed one rather than have to
 * go and find it, and finding it per-file would mean each file querying Mongo
 * on its own.
 */
import fs from "node:fs";
import path from "node:path";
import { assertSafeTarget, BASE_URL, TEST_DB_URI } from "./config.mjs";
import { waitForServer } from "./client.mjs";
import { seed, reset, disconnect } from "./seed.mjs";

export const FIXTURES_FILE = path.join(import.meta.dirname, "..", ".fixtures.json");

export async function setup() {
  assertSafeTarget();

  console.log(`\n  target   ${BASE_URL}`);
  console.log(`  database ${TEST_DB_URI.replace(/\/\/[^@]+@/, "//***@")}\n`);

  await waitForServer(BASE_URL);
  const fixtures = await seed();
  fs.writeFileSync(FIXTURES_FILE, JSON.stringify(fixtures, null, 2));
}

export async function teardown() {
  // Keep the marked records out of the way, but leave the fixtures file: it is
  // useful for debugging a failure straight after a run.
  await reset();
  await disconnect();
}
