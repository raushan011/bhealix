import { test, expect, type Page } from "@playwright/test";
import { signIn, watchConsole } from "./support";

/**
 * Correcting a part-paid bill in the browser, and chasing what is left of it.
 *
 * These are the two things a desk does to a bill nobody has finished paying, and
 * the first of them used to be impossible: the edit screen refused outright while
 * any receipt stood, so a wrong quantity on a half-paid bill could only be fixed
 * by deleting the record of money that had actually been handed over.
 *
 * Driven through the UI rather than the API on purpose — the API suite already
 * proves the rules, and what this covers is the part a person touches: that Save
 * saves, that a bill can carry more than one follow-up, and that taking a part
 * payment asks when the rest is coming while somebody is still there to answer.
 *
 * The bill is raised and removed through the API. Building it through the form
 * would be testing the pickers, and cleaning up matters more: the seeder's reset
 * only removes what it seeded itself.
 */

const iso = (days = 0) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};

/**
 * The API as the signed-in tab sees it.
 *
 * Called through `page.evaluate` rather than Playwright's request context: the
 * session is an httpOnly cookie the page already holds, and a same-origin fetch
 * carries it without the test having to know anything about it.
 */
type Reply = { status: number; body: { error?: string; data?: Record<string, unknown> } | null };
const api = (page: Page) => (method: string, url: string, body?: unknown): Promise<Reply> =>
  page.evaluate(async ({ method, url, body }) => {
    const response = await fetch(url, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, { method, url, body });

/** A bill of supply for the seeded rep, part paid, with one chase already agreed. */
async function raiseBill(page: Page) {
  const call = api(page);

  const doctors = await call("GET", `/api/doctors?q=${encodeURIComponent("Test Doctor 1")}&limit=5`);
  expect(doctors.status, JSON.stringify(doctors.body)).toBe(200);
  const doctor = (doctors.body!.data!.items as Array<{ _id: string; name: string }>)
    .find(entry => entry.name === "Test Doctor 1")!;

  const staff = await call("GET", "/api/team?field=1");
  expect(staff.status, JSON.stringify(staff.body)).toBe(200);
  const rep = (staff.body!.data!.items as Array<{ _id: string; employeeId: string }>)
    .find(person => person.employeeId === "TEST-MR")!;

  const raised = await call("POST", "/api/invoices", {
    partySource: "Doctor",
    doctor: doctor._id,
    employee: rep._id,
    taxed: false,
    invoiceDate: iso(),
    dueDate: iso(15),
    followUps: [{ date: iso(3), note: "first call" }],
    items: [{ name: "Test Product 1", quantity: 10, rate: 100, gstRate: 0 }],
    payment: { amount: 400, mode: "Cash", paidAt: iso() }
  });
  expect(raised.status, JSON.stringify(raised.body)).toBe(201);
  return raised.body!.data!._id as string;
}

async function removeBill(page: Page, id: string) {
  const call = api(page);
  const detail = await call("GET", `/api/invoices/${id}`);
  const invoice = detail.body?.data?.invoice as { payments?: Array<{ _id: string }> } | undefined;
  for (const payment of invoice?.payments ?? []) {
    await call("DELETE", `/api/invoices/${id}/payments?payment=${payment._id}`);
  }
  await call("DELETE", `/api/invoices/${id}`);
}

test.describe("a part-paid bill at the desk", () => {
  test("is corrected, chased on several dates, and asks for the next date when money comes in", async ({ page }) => {
    const errors = watchConsole(page);
    await signIn(page, "ADMIN");

    const id = await raiseBill(page);
    try {
      await page.goto(`/admin/billing/${id}`);

      // The chase agreed when the bill was raised is on the bill, as the next one.
      const collection = page.locator("section", { has: page.getByText("Follow-ups", { exact: true }) }).first();
      await expect(collection.getByText("first call")).toBeVisible();
      await expect(collection.getByText("Next", { exact: true })).toBeVisible();

      // ---------------------------------------------------- correcting the bill
      await page.getByRole("link", { name: /^Edit$/ }).click();
      await expect(page.getByRole("heading", { level: 1 })).toContainText("Edit");
      // The receipt is named, with what it means for the correction.
      await expect(page.getByText(/has already been received against this bill/)).toBeVisible();

      await page.getByLabel("Quantity").fill("12");
      // A second chase, agreed while the bill was open.
      await page.getByRole("button", { name: /Add a follow-up/ }).click();
      await page.getByLabel("Follow-up 2 date").fill(iso(6));
      await page.getByLabel("Follow-up 2 note").fill("second call");

      await page.getByRole("button", { name: /Save changes/ }).click();

      // Landing back on the bill is the whole of the bug: this used to be refused.
      await page.waitForURL(new RegExp(`/admin/billing/${id}$`));
      await expect(page.getByText("₹1,200.00").first()).toBeVisible();
      await expect(page.getByText("Partially paid").first()).toBeVisible();
      await expect(page.getByText("second call")).toBeVisible();
      await expect(page.getByText("first call")).toBeVisible();

      // -------------------------------------------- a receipt, and the next date
      await page.getByRole("button", { name: /Record payment/ }).click();
      await page.getByLabel("Amount received").fill("200");
      await page.getByRole("button", { name: /^Record payment$/ }).last().click();

      await expect(page.getByRole("heading", { name: /When is the rest expected\?/ })).toBeVisible();
      await expect(page.getByText(/₹600\.00 is still outstanding/)).toBeVisible();
      await page.getByRole("button", { name: /In 15 days/ }).click();
      await page.getByLabel("What was agreed").fill("balance after the 15th");
      await page.getByRole("button", { name: /Save follow-up/ }).click();

      await expect(page.getByText(/Follow-up set for/)).toBeVisible();
      await expect(page.getByText("balance after the 15th")).toBeVisible();
      // Three chases now stand against the one bill, which is the point of a list.
      await expect(collection.locator("li")).toHaveCount(3);
      await expect(page.getByText("₹600.00").first()).toBeVisible();

      // -------------------------------------------------- marking a call as made
      await page.getByRole("button", { name: /Mark this follow-up as made/ }).first().click();
      await expect(page.getByText("Made", { exact: true }).first()).toBeVisible();
    } finally {
      // Back on an app page either way, so the clean-up fetch carries the session.
      await page.goto("/admin/billing");
      await removeBill(page, id);
    }

    expect(errors, errors.join("\n")).toEqual([]);
  });
});
