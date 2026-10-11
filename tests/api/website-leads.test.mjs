/**
 * Website carts, end to end: a shopper's number arriving from the leads sheet,
 * filed once per phone, handed to an executive and worked from their list.
 *
 * Needs the server started with `WEBSITE_LEADS_TOKEN` set to the same value as
 * this process (`test-website-token` when neither sets one).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { as, anonymous } from "../support/client.mjs";

const PREFIX = "__webcart__";
const TOKEN = process.env.WEBSITE_LEADS_TOKEN || "test-website-token";
const PHONE = "6000000123";
const post = (client, body, token = TOKEN) => client.post("/api/website/leads", body, { headers: token ? { "x-api-key": token } : {} });
const cart = (over = {}) => ({ name: `${PREFIX} Riya`, phone: `+91${PHONE}`, product: "Anti-Pigmentation Kit", variant: "1", qty: 1, page: "https://www.bhealix.com/products/kit", source: "facebook / test", ...over });

let admin, exec, exec2, outsider, leadId;

async function sweep() {
  const result = await admin.get("/api/sales/leads?limit=100&q=" + encodeURIComponent(PREFIX));
  for (const row of result.data?.items ?? []) await admin.delete(`/api/sales/leads/${row._id}`);
}

beforeAll(async () => {
  [admin, exec, exec2] = await Promise.all([as("ADMIN"), as("EXECUTIVE"), as("EXECUTIVE2")]);
  outsider = anonymous();
  await sweep();
});
afterAll(async () => { await sweep(); });

describe("the website's door", () => {
  it("refuses a post without the token, or with the wrong one", async () => {
    expect((await post(outsider, cart(), null)).status).toBe(401);
    expect((await post(outsider, cart(), "wrong-token")).status).toBe(401);
  });

  it("refuses a number that is not a mobile", async () => {
    expect((await post(outsider, cart({ phone: "12345" }))).status).toBe(400);
  });

  it("files a new shopper once, and adds a second cart to the same lead", async () => {
    const first = await post(outsider, cart());
    expect(first.status).toBe(201);
    leadId = first.data._id;
    const again = await post(outsider, cart({ product: "Face Wash", qty: 2 }));
    expect(again.status).toBe(200);
    expect(again.data).toMatchObject({ _id: leadId, existed: true });
  });
});

describe("the desk's Website carts", () => {
  it("lists the cart, newest product first, with the tracking table", async () => {
    const list = await admin.get(`/api/sales-team/leads?source=Website&assigned=none&q=${encodeURIComponent(PREFIX)}`);
    expect(list.status).toBe(200);
    const row = list.data.items.find(item => item._id === leadId);
    expect(row).toMatchObject({ source: "Website", type: "Website cart", status: "New", phone: PHONE, cart: { lastProduct: "Face Wash", count: 2 } });
    expect(list.data.byExecutive[0].name).toBe("Not assigned");
  });

  it("shows both carts and their remarks on the lead", async () => {
    const detail = await admin.get(`/api/sales-team/leads/${leadId}`);
    expect(detail.data.lead.cart.events).toHaveLength(2);
    expect(detail.data.lead.remarks.map(remark => remark.text)).toEqual([
      "Added to cart again on the website: Face Wash × 2 (via facebook / test).",
      "Added to cart on the website: Anti-Pigmentation Kit (via facebook / test)."
    ]);
  });

  it("hands it to an executive, who sees it and can work it — and nobody else can", async () => {
    const me = (await admin.get("/api/sales-team/executives")).data.items.find(person => person.email === "test-exec@bhealix.test");
    expect((await admin.post("/api/sales-team/leads/assign", { leadIds: [leadId], executive: me._id })).data.assigned).toBe(1);

    const mine = await exec.get(`/api/sales-team/leads?q=${encodeURIComponent(PREFIX)}`);
    expect(mine.data.items.map(item => item._id)).toContain(leadId);
    expect(mine.data.byExecutive).toBeUndefined();
    expect((await exec2.get(`/api/sales-team/leads/${leadId}`)).status).toBe(404);

    expect((await exec.post(`/api/sales-team/leads/${leadId}`, { text: "Rang — wants the kit on COD", channel: "Call", status: "Interested" })).status).toBe(201);
    const tracked = await admin.get(`/api/sales-team/leads?source=Website&assigned=${me._id}&q=${encodeURIComponent(PREFIX)}`);
    expect(tracked.data.items[0].status).toBe("Interested");
    expect(tracked.data.byExecutive.find(row => row.executive === me._id).counts.Interested).toBeGreaterThanOrEqual(1);
  });

  it("keeps a third cart on the executive's lead, without moving it", async () => {
    await post(outsider, cart({ product: "Sunscreen" }));
    const detail = await exec.get(`/api/sales-team/leads/${leadId}`);
    expect(detail.data.lead).toMatchObject({ status: "Interested", cart: { count: 3, lastProduct: "Sunscreen" } });
  });
});
