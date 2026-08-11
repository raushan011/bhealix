import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests against the built app and the test database.
 *
 * The server is not started here. `webServer` would launch `next start`, which
 * reads `.env.local` — and on this project that points at the live Atlas
 * cluster, so the browser suite would quietly click around production. Start it
 * with `npm run test:serve` instead, which puts the test database into the
 * environment first.
 */
const BASE_URL = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "./tests/e2e",
  // The suite signs the same accounts in and out and writes shared records;
  // running files in parallel makes them fight over each other's state.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  timeout: 60_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    // The app is built for a phone in the field as much as a desk.
    actionTimeout: 15_000
  },

  projects: [
    { name: "desk", use: { ...devices["Desktop Chrome"] } },
    {
      name: "field",
      use: {
        ...devices["Pixel 7"],
        // Visit photos are refused without a location, so the field project
        // grants geolocation the way a rep's phone would.
        permissions: ["geolocation"],
        geolocation: { latitude: 19.076, longitude: 72.8777 },
        locale: "en-IN"
      }
    }
  ]
});
