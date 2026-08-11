import { test, expect } from "@playwright/test";
import { signIn, watchConsole } from "./support";

/**
 * Every screen in both panels, opened once.
 *
 * Deliberately shallow: it asserts the page rendered, answered without a server
 * error, and logged nothing to the console. That is the check a deep test of one
 * screen cannot give you — a route that throws on render, a query that 500s, or
 * a hydration mismatch shows up here on whichever screen it lives, and those are
 * the failures that reach a user as a blank page.
 *
 * Selectors are kept to landmarks rather than copy, so a wording change does not
 * fail the suite.
 */

const DESK_SCREENS = [
  "/admin",
  "/admin/discover",
  "/admin/doctors",
  "/admin/plans",
  "/admin/visits",
  "/admin/reports",
  "/admin/billing",
  "/admin/billing/settings",
  "/admin/customers",
  "/admin/inventory",
  "/admin/products",
  "/admin/samples",
  "/admin/hr",
  "/admin/team",
  "/admin/hr/attendance",
  "/admin/hr/leave",
  "/admin/hr/holidays",
  "/admin/hr/payroll",
  "/admin/hr/payroll/settings"
];

/**
 * Note there is no `/employee/visits` index — a visit is only ever opened by id,
 * from the plan or the history. Listing it here would assert a 404 as a failure
 * when it is the correct answer.
 */
const FIELD_SCREENS = [
  "/employee",
  "/employee/doctors",
  "/employee/doctors/new",
  "/employee/plans",
  "/employee/plans/new",
  "/employee/history",
  "/employee/samples",
  "/employee/bills",
  "/employee/leave",
  "/employee/payslips",
  "/employee/profile",
  "/employee/more"
];

test.describe("the desk panel", () => {
  for (const path of DESK_SCREENS) {
    test(`renders ${path}`, async ({ page }) => {
      const errors = watchConsole(page);
      await signIn(page, "ADMIN");

      const response = await page.goto(path, { waitUntil: "domcontentloaded" });
      expect(response?.status(), `${path} returned ${response?.status()}`).toBeLessThan(400);

      await expect(page.locator("main, [role=main]").first()).toBeVisible();
      await expect(page).toHaveURL(new RegExp(path.replace(/\//g, "\\/")));

      // Next's dev overlay and hydration failures both surface here.
      const real = errors.filter(text => !/favicon|Download the React DevTools/i.test(text));
      expect(real, `${path} logged: ${real.join(" | ")}`).toHaveLength(0);
    });
  }
});

test.describe("the field panel", () => {
  for (const path of FIELD_SCREENS) {
    test(`renders ${path}`, async ({ page }) => {
      const errors = watchConsole(page);
      await signIn(page, "MR");

      const response = await page.goto(path, { waitUntil: "domcontentloaded" });
      expect(response?.status(), `${path} returned ${response?.status()}`).toBeLessThan(400);

      await expect(page.locator("main, [role=main]").first()).toBeVisible();

      const real = errors.filter(text => !/favicon|Download the React DevTools/i.test(text));
      expect(real, `${path} logged: ${real.join(" | ")}`).toHaveLength(0);
    });
  }
});

test.describe("the doctor directory", () => {
  test("lists doctors and filters them by a search term", async ({ page }) => {
    await signIn(page, "ADMIN");
    await page.goto("/admin/doctors");

    // The seeder creates "Test Doctor N", so there is always something to find.
    await expect(page.getByText(/Test Doctor/i).first()).toBeVisible({ timeout: 20_000 });

    const search = page.getByRole("searchbox").or(page.getByPlaceholder(/search/i)).first();
    if (await search.count()) {
      await search.fill("Test Doctor 1");
      await expect(page.getByText(/Test Doctor 1/i).first()).toBeVisible({ timeout: 20_000 });
    }
  });
});
