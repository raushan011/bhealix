/**
 * The sales team, end to end: a lead handed to an executive, converted into an
 * order, delivered, and its incentive paid — and every wall between one
 * executive's records and another's, and between an executive and the rest of
 * the company.
 *
 * Booking with Shiprocket is exercised only where it fails: the test database
 * has no courier account, and a suite that booked real parcels every time it
 * ran would be shipping boxes to nobody. Delivery is therefore set with the
 * administrator's manual correction, which drives the incentive through exactly
 * the same `recalculateIncentive` the courier's report would.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { as } from "../support/client.mjs";
import { connect } from "../support/seed.mjs";

const PREFIX = "__teamtest__";

const customer = (suffix) => ({
  name: `${PREFIX} Customer ${suffix}`,
  phone: "9876543210",
  address1: "12 MG Road",
  city: "Patna",
  state: "Bihar",
  pinCode: "800001"
});

const order = (suffix, over = {}) => ({
  customer: customer(suffix),
  items: [{ title: "Skin pigmentation kit", quantity: 1, price: 1500 }, { title: "Serum", quantity: 2, price: 250 }],
  discount: 0,
  paymentMode: "COD",
  ...over
});

let admin, hr, mr, exec, exec2;
let originalRules, originalChannel;

async function sweep() {
  const db = (await connect()).db;
  await db.collection("salesteamorders").deleteMany({ "customer.name": { $regex: `^${PREFIX}` } });
  await db.collection("salesleads").deleteMany({ name: { $regex: `^${PREFIX}` } });
}

beforeAll(async () => {
  [admin, hr, mr, exec, exec2] = await Promise.all([as("ADMIN"), as("HR"), as("MR"), as("EXECUTIVE"), as("EXECUTIVE2")]);
  await sweep();
  const current = (await admin.get("/api/sales-team/settings")).data;
  originalRules = current.incentiveRules;
  originalChannel = current.orderChannel;
  // Known rules for the arithmetic below, and direct orders — the test database
  // has no Shopify store to place them in. Both restored afterwards.
  const saved = await admin.put("/api/sales-team/settings", {
    orderChannel: "Direct",
    incentiveRules: [
      { mode: "COD", enabled: true, type: "Flat", value: 50 },
      { mode: "Prepaid", enabled: true, type: "Percentage", value: 5 },
      { mode: "Partial", enabled: true, type: "Percentage", value: 4 }
    ]
  });
  expect(saved.status).toBe(200);
});

afterAll(async () => {
  await admin.put("/api/sales-team/settings", { incentiveRules: originalRules, orderChannel: originalChannel });
  await sweep();
});

describe("placing an order", () => {
  it("works out every figure on the server, whatever the request claims", async () => {
    const created = await exec.post("/api/sales-team/orders", order("partial", {
      paymentMode: "Partial", advancePaid: 200, discount: 100, totals: { paid: 1 }
    }));
    expect(created.status).toBe(201);

    const { data } = await exec.get(`/api/sales-team/orders/${created.data._id}`);
    expect(data.order.totals).toEqual({ gross: 2000, discount: 100, paid: 1900 });
    expect(data.order.collectAmount).toBe(1700);
    expect(data.order.name).toMatch(/^BHX-SE-\d{5}$/);
    // 4% of 1,900, frozen from the Partial rule, pending until delivered.
    expect(data.order.incentive).toMatchObject({ type: "Percentage", value: 4, amount: 76, status: "Pending" });
  });

  it("keeps an executive's order theirs, whatever executive the request names", async () => {
    const people = (await admin.get("/api/sales-team/executives")).data.items;
    const other = people.find(person => person.email === "test-exec2@bhealix.test");
    const created = await exec.post("/api/sales-team/orders", order("own", { executive: other._id }));
    const { data } = await admin.get(`/api/sales-team/orders/${created.data._id}`);
    expect(data.order.executiveName).toBe("Test Executive");
  });

  it("makes an administrator say whose sale it is", async () => {
    const refused = await admin.post("/api/sales-team/orders", order("nobody"));
    expect(refused.status).toBe(400);
    expect(refused.error).toMatch(/sales executive/);
  });

  it("refuses a part payment that is really COD", async () => {
    const refused = await exec.post("/api/sales-team/orders", order("bad", { paymentMode: "Partial", advancePaid: 0 }));
    expect(refused.status).toBe(400);
  });
});

describe("one executive's records are not another's", () => {
  let id;
  beforeAll(async () => {
    id = (await exec.post("/api/sales-team/orders", order("private"))).data._id;
  });

  it("hides the order from a colleague", async () => {
    expect((await exec2.get(`/api/sales-team/orders/${id}`)).status).toBe(404);
    const list = await exec2.get(`/api/sales-team/orders?q=${encodeURIComponent(PREFIX)}`);
    expect(list.data.items.some(row => row._id === id)).toBe(false);
    expect((await exec2.patch(`/api/sales-team/orders/${id}`, { action: "cancel", reason: "not mine" })).status).toBe(404);
  });

  it("lets the desk read it and the field team not at all", async () => {
    expect((await hr.get(`/api/sales-team/orders/${id}`)).status).toBe(200);
    expect((await mr.get(`/api/sales-team/orders/${id}`)).status).toBe(403);
  });

  it("keeps the executive out of the rest of the company", async () => {
    for (const path of ["/api/visits", "/api/invoices", "/api/doctors", "/api/team", "/api/sales/orders", "/api/sales/leads", "/api/hr/payroll"]) {
      expect((await exec.get(path)).status, path).toBe(403);
    }
  });
});

describe("from delivery to payment", () => {
  let id;
  beforeAll(async () => {
    id = (await exec.post("/api/sales-team/orders", order("paid", { paymentMode: "Prepaid", paymentReference: "UPI123" }))).data._id;
  });

  it("is owed once delivered", async () => {
    expect((await exec.patch(`/api/sales-team/orders/${id}`, { action: "override", state: "Delivered" })).status).toBe(403);
    const corrected = await admin.patch(`/api/sales-team/orders/${id}`, { action: "override", state: "Delivered", reason: "Customer confirmed" });
    expect(corrected.status).toBe(200);
    const { data } = await exec.get(`/api/sales-team/orders/${id}`);
    expect(data.order.incentive).toMatchObject({ status: "Payable", amount: 100 });
  });

  it("is paid by the administrator only, once", async () => {
    const body = { action: "pay", orderIds: [id], paymentDate: "2026-10-01", mode: "UPI", reference: "UTR1" };
    expect((await exec.post("/api/sales-team/incentives", body)).status).toBe(403);
    expect((await hr.post("/api/sales-team/incentives", body)).status).toBe(403);

    const paid = await admin.post("/api/sales-team/incentives", body);
    expect(paid.data).toMatchObject({ paid: 1, amount: 100 });
    const again = await admin.post("/api/sales-team/incentives", body);
    expect(again.data.paid).toBe(0);

    const statement = await exec.get("/api/sales-team/incentives?status=Paid");
    expect(statement.data.items.some(row => row._id === id)).toBe(true);
  });

  it("is never restated when the parcel later comes back — only flagged", async () => {
    await admin.patch(`/api/sales-team/orders/${id}`, { action: "override", state: "RTO", reason: "Returned" });
    const { data } = await admin.get(`/api/sales-team/orders/${id}`);
    expect(data.order.incentive).toMatchObject({ status: "Paid", amount: 100, needsReversal: true });
  });
});

describe("cancelling and booking", () => {
  it("voids the incentive of a cancelled order", async () => {
    const id = (await exec.post("/api/sales-team/orders", order("cancel"))).data._id;
    expect((await exec.patch(`/api/sales-team/orders/${id}`, { action: "cancel", reason: "Customer changed mind" })).status).toBe(200);
    const { data } = await exec.get(`/api/sales-team/orders/${id}`);
    expect(data.order.incentive.status).toBe("Void");
    expect(data.may.book).toBe(false);
  });

  it("says plainly when Shiprocket is not connected", async () => {
    const id = (await exec.post("/api/sales-team/orders", order("book"))).data._id;
    const result = await exec.post(`/api/sales-team/orders/${id}/book`, {
      pickupLocation: "Primary", parcel: { weight: 0.5, length: 20, breadth: 15, height: 8 }
    });
    expect([502, 400]).toContain(result.status);
    expect(result.error).toMatch(/Shiprocket/);
  });
});

describe("leads handed to an executive", () => {
  let leadId;
  beforeAll(async () => {
    await admin.post("/api/sales/leads", {
      leads: [{ placeId: `${PREFIX}lead1`, name: `${PREFIX} Glow Salon`, type: "Salon test", city: "Patna", phone: "9876543210", address: "1 Boring Road" }]
    });
    const list = await admin.get(`/api/sales-team/leads?assigned=none&q=${encodeURIComponent(PREFIX)}`);
    leadId = list.data.items[0]._id;
  });

  it("is the administrator's to hand out", async () => {
    const people = (await admin.get("/api/sales-team/executives")).data.items;
    const me = people.find(person => person.email === "test-exec@bhealix.test");
    expect((await exec.post("/api/sales-team/leads/assign", { leadIds: [leadId], executive: me._id })).status).toBe(403);
    const assigned = await admin.post("/api/sales-team/leads/assign", { leadIds: [leadId], executive: me._id });
    expect(assigned.data.assigned).toBe(1);
  });

  it("shows only to the executive it was handed to", async () => {
    expect((await exec.get(`/api/sales-team/leads/${leadId}`)).status).toBe(200);
    expect((await exec2.get(`/api/sales-team/leads/${leadId}`)).status).toBe(404);
    expect((await exec2.post(`/api/sales-team/leads/${leadId}`, { text: "Rang", channel: "Call" })).status).toBe(404);
  });

  it("takes a remark, but not a hand-set Converted", async () => {
    expect((await exec.post(`/api/sales-team/leads/${leadId}`, { text: "Interested, wants prices", channel: "Call", status: "Interested" })).status).toBe(201);
    expect((await exec.post(`/api/sales-team/leads/${leadId}`, { text: "Done", channel: "Note", status: "Converted" })).status).toBe(400);
  });

  it("becomes Converted when an order is placed from it — by its executive only", async () => {
    expect((await exec2.post("/api/sales-team/orders", order("lead2", { lead: leadId }))).status).toBe(403);
    const created = await exec.post("/api/sales-team/orders", order("lead", { lead: leadId }));
    expect(created.status).toBe(201);
    const { data } = await exec.get(`/api/sales-team/leads/${leadId}`);
    expect(data.lead.status).toBe("Converted");
    expect(data.orders.map(row => row._id)).toContain(created.data._id);
  });
});

describe("ordering through Shopify", () => {
  it("is the default, and refuses plainly when the shop cannot take orders", async () => {
    await admin.put("/api/sales-team/settings", { incentiveRules: originalRules, orderChannel: "Shopify" });
    try {
      const settings = await exec.get("/api/sales-team/settings");
      expect(settings.data.orderChannel).toBe("Shopify");
      expect(settings.data.shopifyRefusal).toMatch(/Shopify/);

      const refused = await exec.post("/api/sales-team/orders", order("shop"));
      expect(refused.status).toBe(502);
      expect(refused.error).toMatch(/Shopify is not connected/);

      const products = await exec.get("/api/sales-team/products");
      expect(products.data).toMatchObject({ source: "Shopify", items: [] });
    } finally {
      await admin.put("/api/sales-team/settings", { incentiveRules: originalRules, orderChannel: "Direct" });
    }
  });
});

describe("a repeat customer", () => {
  it("is recognised by phone, from the executive's own orders only", async () => {
    await exec.post("/api/sales-team/orders", order("repeat", { customer: { ...customer("repeat"), phone: "9123456780", address1: "7 Fraser Road" } }));
    const found = await exec.get("/api/sales-team/customers?phone=+91 91234 56780");
    expect(found.data.customer.address1).toBe("7 Fraser Road");
    expect(found.data.orders).toBeGreaterThanOrEqual(1);
    expect((await exec2.get("/api/sales-team/customers?phone=9123456780")).data.customer).toBeNull();
  });
});

describe("the overview", () => {
  it("gives each executive their own figures and the desk everybody's", async () => {
    const own = await exec.get("/api/sales-team/overview");
    expect(own.data.executives).toHaveLength(1);
    expect(own.data.executives[0].executive.name).toBe("Test Executive");

    const desk = await admin.get("/api/sales-team/overview");
    const names = desk.data.executives.map(row => row.executive.name);
    expect(names).toEqual(expect.arrayContaining(["Test Executive", "Test Executive Two"]));
  });
});
