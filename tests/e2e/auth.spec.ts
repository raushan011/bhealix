import { test, expect } from "@playwright/test";
import { ACCOUNTS, TEST_PASSWORD, identifierField, passwordField } from "./support";

/**
 * Signing in, and the routing that follows it.
 *
 * The role decides which panel somebody lands on, and getting that wrong sends
 * a rep to a desk screen they cannot use on a phone. It is checked here rather
 * than in the API suite because the redirect happens in the browser, after the
 * cookie is set.
 */

test.describe("sign in", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
  });

  test("shows the form", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(identifierField(page)).toBeVisible();
    await expect(passwordField(page)).toBeVisible();
  });

  test("refuses a wrong password and says so without reloading", async ({ page }) => {
    await identifierField(page).fill(ACCOUNTS.ADMIN.email);
    await passwordField(page).fill("wrong-password");
    await page.getByRole("button", { name: /sign in/i }).click();

    // Scoped to the form: Next's own route announcer is also `role="alert"`,
    // so an unscoped match is ambiguous and resolves to the empty one first.
    await expect(page.locator("form").getByRole("alert")).toContainText(/incorrect/i);
    await expect(page).toHaveURL(/\/login/);
  });

  test("sends an administrator to the desk panel", async ({ page }) => {
    await identifierField(page).fill(ACCOUNTS.ADMIN.email);
    await passwordField(page).fill(TEST_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page).toHaveURL(/\/admin/, { timeout: 30_000 });
  });

  test("sends a representative to the field panel", async ({ page }) => {
    await identifierField(page).fill(ACCOUNTS.MR.email);
    await passwordField(page).fill(TEST_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page).toHaveURL(/\/employee/, { timeout: 30_000 });
  });

  test("accepts an employee ID in place of the email", async ({ page }) => {
    await identifierField(page).fill(ACCOUNTS.MR.employeeId);
    await passwordField(page).fill(TEST_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page).toHaveURL(/\/employee/, { timeout: 30_000 });
  });
});

test.describe("the guard on the panels", () => {
  test("sends a signed-out visitor to the login screen", async ({ page }) => {
    for (const path of ["/admin", "/employee", "/admin/doctors", "/admin/hr/payroll"]) {
      await page.goto(path);
      await expect(page, `${path} did not redirect`).toHaveURL(/\/login/);
    }
  });

  /**
   * A rep who types an admin URL must be sent to their own panel, not shown the
   * desk one. This is the browser half of the RBAC matrix.
   */
  test("sends a representative away from the desk panel", async ({ page }) => {
    await page.goto("/login");
    await identifierField(page).fill(ACCOUNTS.MR.email);
    await passwordField(page).fill(TEST_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/employee/, { timeout: 30_000 });

    for (const path of ["/admin", "/admin/hr/payroll", "/admin/team"]) {
      await page.goto(path);
      await expect(page, `${path} was reachable by a rep`).toHaveURL(/\/employee/);
    }
  });
});
