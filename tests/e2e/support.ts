import type { Page } from "@playwright/test";

/**
 * Shared helpers for the browser suite.
 *
 * The accounts are restated rather than imported from `tests/support/config.mjs`
 * so the Playwright project needs no interop with the plain-ESM harness; they
 * must stay in step with the seeder.
 */

export const TEST_PASSWORD = process.env.TEST_PASSWORD ?? "TestOnly@12345";

export const ACCOUNTS = {
  ADMIN: { employeeId: "TEST-ADMIN", email: "test-admin@bhealix.test" },
  HR: { employeeId: "TEST-HR", email: "test-hr@bhealix.test" },
  MR: { employeeId: "TEST-MR", email: "test-mr@bhealix.test" },
  MR2: { employeeId: "TEST-MR2", email: "test-mr2@bhealix.test" },
  SALES: { employeeId: "TEST-SALES", email: "test-sales@bhealix.test" }
};

/**
 * The two login fields, located by form name.
 *
 * `getByLabel("Password")` is ambiguous here — the show/hide toggle inside the
 * field carries an `aria-label` of "Show password", so the accessible-name match
 * finds both the input and the button. The `name` attribute is what the form
 * actually submits, so it is both unambiguous and the more meaningful contract.
 */
export const identifierField = (page: Page) => page.locator('input[name="identifier"]');
export const passwordField = (page: Page) => page.locator('input[name="password"]');

/** Signs in through the form and waits for the panel to take over. */
export async function signIn(page: Page, role: keyof typeof ACCOUNTS) {
  await page.goto("/login");
  await identifierField(page).fill(ACCOUNTS[role].email);
  await passwordField(page).fill(TEST_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();

  const panel = role === "ADMIN" || role === "HR" ? /\/admin/ : /\/employee/;
  await page.waitForURL(panel, { timeout: 30_000 });
}

/**
 * Fails the test if the browser console carried an error.
 *
 * A page can look right and still be throwing on every render; without this the
 * suite would pass while the app logs a hydration mismatch on each load.
 */
export function watchConsole(page: Page) {
  const errors: string[] = [];
  page.on("console", message => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", error => errors.push(error.message));
  return errors;
}
