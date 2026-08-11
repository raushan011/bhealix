/**
 * Starts the built app against the test database.
 *
 * `next start` would otherwise read `.env.local`, which on this project points
 * at the live Atlas cluster — so running the suite would load-test and
 * probe production while looking for all the world like a local run. This puts
 * the test database into the environment first, where it takes precedence over
 * the env files, and keeps the connection string off the command line so it
 * stays out of shell history and process listings.
 *
 *   node tests/support/serve.mjs [--port 3000]
 */
import { spawn } from "node:child_process";
import { TEST_DB_URI, BASE_URL, assertSafeTarget } from "./config.mjs";

assertSafeTarget();

const portFlag = process.argv.indexOf("--port");
const port = portFlag > -1 ? process.argv[portFlag + 1] : (new URL(BASE_URL).port || "3000");

console.log(`Starting on port ${port} against ${TEST_DB_URI.replace(/\/\/[^@]+@/, "//***@")}`);

const child = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["next", "start", "--port", port],
  {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, MONGODB_URI: TEST_DB_URI, PORT: port }
  }
);

child.on("exit", code => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
