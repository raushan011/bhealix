import { defineConfig } from "vitest/config";

/**
 * The integration and security suites, kept apart from the unit tests.
 *
 * `npm test` stays fast and needs nothing running. These files talk to a real
 * server and a real database, so they are opt-in: `npm run test:api`.
 *
 * File parallelism is off deliberately. Every file shares one database, and a
 * suite that truncates or counts records while another is inserting them fails
 * intermittently — which is worse than failing honestly, because the usual
 * response is to re-run it until it passes.
 */
export default defineConfig({
  test: {
    include: ["tests/api/**/*.test.mjs", "tests/security/**/*.test.mjs"],
    globalSetup: ["tests/support/global-setup.mjs"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    reporters: ["default"]
  }
});
