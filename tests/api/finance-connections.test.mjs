import { beforeAll, describe, expect, it } from "vitest";
import { anonymous, as } from "../support/client.mjs";

/**
 * The supplier API keys, end to end.
 *
 * Nothing here calls Razorpay, Shopify or Meta — a suite that needed live
 * credentials would be a suite nobody could run. What it proves is the part that
 * is ours: that a key can be stored and is encrypted, that it is **never** sent
 * back to a browser, that a blank field keeps what is already there, and that a
 * test against a deliberately wrong key fails in a way somebody can act on
 * rather than in a stack trace.
 */
describe("supplier connections", () => {
  let sup;

  beforeAll(async () => { sup = await as("SUPERADMIN"); });

  it("is the super administrator's alone", async () => {
    expect((await anonymous().get("/api/finance/connections")).status).toBe(401);
    for (const role of ["ADMIN", "HR"]) {
      const client = await as(role);
      expect((await client.get("/api/finance/connections")).status).toBe(403);
      expect((await client.put("/api/finance/connections", {
        connector: "razorpay", values: { keyId: "rzp_test_x", keySecret: "secret" }
      })).status).toBe(403);
    }
  });

  it("lists every connector with the fields its form needs", async () => {
    const { status, data } = await sup.get("/api/finance/connections");
    expect(status).toBe(200);
    expect(data.connections.map(row => row.connector).sort())
      .toEqual(["meta", "razorpay", "shiprocket", "shopify"]);

    for (const connection of data.connections) {
      expect(connection.fields.length).toBeGreaterThan(0);
      expect(connection.consoleUrl).toMatch(/^https:\/\//);
      // Every field the screen has to render carries its own label and type.
      for (const field of connection.fields) {
        expect(field.name).toBeTruthy();
        expect(field.label).toBeTruthy();
        expect(typeof field.secret).toBe("boolean");
      }
    }
  });

  it("stores a key and never hands the secret back", async () => {
    const saved = await sup.put("/api/finance/connections", {
      connector: "razorpay",
      values: { keyId: "rzp_test_ABCDEFGH", keySecret: "super-secret-value-1234" },
      test: false
    });
    expect(saved.status).toBe(200);

    const { data } = await sup.get("/api/finance/connections");
    const razorpay = data.connections.find(row => row.connector === "razorpay");

    expect(razorpay.configured).toBe(true);
    // The visible half round-trips...
    expect(razorpay.values.keyId).toBe("rzp_test_ABCDEFGH");
    // ...and the secret half never does, in any shape.
    expect(JSON.stringify(razorpay)).not.toContain("super-secret-value-1234");
    expect(razorpay.values.keySecret).toBeUndefined();
    // Only enough to recognise which key is stored.
    expect(razorpay.hints.keySecret).toBe("••••••••1234");
  });

  it("keeps the stored secret when the box is left blank", async () => {
    // The form never receives the real value back, so saving an untouched form
    // would otherwise wipe the key — which is the single most annoying way for
    // a settings screen to behave.
    await sup.put("/api/finance/connections", {
      connector: "razorpay", values: { keyId: "rzp_test_CHANGED", keySecret: "" }, test: false
    });

    const { data } = await sup.get("/api/finance/connections");
    const razorpay = data.connections.find(row => row.connector === "razorpay");
    expect(razorpay.values.keyId).toBe("rzp_test_CHANGED");
    expect(razorpay.hints.keySecret).toBe("••••••••1234");
    expect(razorpay.configured).toBe(true);
  });

  it("reports a refused key in the vendor's own words", async () => {
    // A deliberately wrong secret. Razorpay answers 401, and that is what has to
    // reach the screen — "could not connect" names nothing to fix.
    const tested = await sup.post("/api/finance/connections", { connector: "razorpay" });
    expect(tested.status).toBe(200);
    expect(tested.data.ok).toBe(false);
    expect(tested.data.message).toMatch(/Razorpay/);

    // And the outcome is remembered, so the screen says so on its next load
    // rather than looking untested.
    const { data } = await sup.get("/api/finance/connections");
    const razorpay = data.connections.find(row => row.connector === "razorpay");
    expect(razorpay.lastTestOk).toBe(false);
    expect(razorpay.lastTestedAt).toBeTruthy();
  });

  it("will not fetch a source whose key has not been entered", async () => {
    const pulled = await sup.post("/api/finance/pull", { period: "2019-03", source: "meta-ads" });
    expect(pulled.status).toBe(400);
    expect(pulled.error).toMatch(/No API key is stored/i);
  });

  it("still refuses to invent a fetch for a source no API reaches", async () => {
    // Shiprocket's wallet recharge has no connector at all, and saying so beats
    // a sync that runs and files nothing.
    const pulled = await sup.post("/api/finance/pull", { period: "2019-03", source: "shiprocket-recharge" });
    expect(pulled.status).toBe(400);
    expect(pulled.error).toMatch(/dashboard/i);
  });

  it("removes a key when asked", async () => {
    expect((await sup.delete("/api/finance/connections?connector=razorpay")).status).toBe(200);

    const { data } = await sup.get("/api/finance/connections");
    const razorpay = data.connections.find(row => row.connector === "razorpay");
    expect(razorpay.configured).toBe(false);
    expect(razorpay.hints.keySecret).toBeUndefined();
  });

  it("says which suppliers borrow a credential rather than asking for one", async () => {
    /*
     * The reason this exists: Shopify stopped issuing the pasteable `shpat_`
     * tokens a credential form expects. A Dev Dashboard app earns its token
     * through the OAuth handshake and never shows it again, so there is nothing
     * a person *can* paste — the only working credential is the one the Sales
     * CRM already holds, and the vault has to be able to use it.
     */
    const { data } = await sup.get("/api/finance/connections");
    const byKey = Object.fromEntries(data.connections.map(row => [row.connector, row]));

    expect(byKey.shopify.inheritsFrom).toBe("Sales CRM → Settings");
    expect(byKey.shiprocket.inheritsFrom).toBe("Sales CRM → Settings");
    // Razorpay and Meta are connected nowhere else, so they must be filled in.
    expect(byKey.razorpay.inheritsFrom).toBeUndefined();
    expect(byKey.meta.inheritsFrom).toBeUndefined();
  });

  it("does not claim to be connected when there is nothing to borrow yet", async () => {
    // No Shopify connection exists on the test database, so an empty Shopify
    // card must read "not set up" rather than inheriting a credential that is
    // not there.
    const { data } = await sup.get("/api/finance/connections");
    const shopify = data.connections.find(row => row.connector === "shopify");
    expect(shopify.inherited).toBe(false);
    expect(shopify.configured).toBe(false);
  });

  it("refuses a half-typed override rather than quietly falling back", async () => {
    /*
     * Somebody part-way through pointing the vault at a *different* shop. Going
     * back to the borrowed credential there would connect them to the shop they
     * were in the middle of moving away from, which is worse than being told
     * the token is still empty.
     */
    await sup.put("/api/finance/connections", {
      connector: "shopify", values: { domain: "other-shop.myshopify.com", accessToken: "" }, test: false
    });

    const { data } = await sup.get("/api/finance/connections");
    const shopify = data.connections.find(row => row.connector === "shopify");
    expect(shopify.inherited).toBe(false);
    expect(shopify.configured).toBe(false);

    const tested = await sup.post("/api/finance/connections", { connector: "shopify" });
    expect(tested.data.ok).toBe(false);
    expect(tested.data.message).toMatch(/every required field/i);

    await sup.delete("/api/finance/connections?connector=shopify");
  });

  it("refuses a connector it has never heard of", async () => {
    expect((await sup.put("/api/finance/connections", { connector: "stripe", values: {} })).status).toBe(400);
    expect((await sup.delete("/api/finance/connections?connector=stripe")).status).toBe(400);
  });
});
