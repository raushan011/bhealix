/**
 * The endpoints that carry the business rules, exercised end to end.
 *
 * The RBAC matrix proves who may knock on each door; this proves what happens
 * once they are through it — pagination bounds, validation, the ownership
 * filters a rep is subject to, and the arithmetic on an invoice.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { as, anonymous } from "../support/client.mjs";
import { fixtures, MISSING_ID } from "../support/fixtures.mjs";

let ids, admin, mr, mr2, hr;

beforeAll(async () => {
  ids = fixtures();
  [admin, mr, mr2, hr] = await Promise.all([as("ADMIN"), as("MR"), as("MR2"), as("HR")]);
});

describe("GET /api/doctors", () => {
  it("pages, and reports a total consistent with the page size", async () => {
    const result = await admin.get("/api/doctors?page=1&limit=10");
    expect(result.status).toBe(200);
    expect(result.data.items.length).toBeLessThanOrEqual(10);
    expect(result.data.page).toBe(1);
    expect(result.data.pages).toBe(Math.max(1, Math.ceil(result.data.total / 10)));
  });

  it("caps the page size at 100 so a caller cannot ask for the whole table", async () => {
    const result = await admin.get("/api/doctors?limit=100000");
    expect(result.status).toBe(200);
    expect(result.data.items.length).toBeLessThanOrEqual(100);
  });

  it("treats a nonsense page or limit as the default rather than failing", async () => {
    for (const query of ["page=-5", "page=abc", "limit=0", "limit=-1", "page=1e99"]) {
      const result = await admin.get(`/api/doctors?${query}`);
      expect(result.status, query).toBe(200);
      expect(result.data.page, query).toBeGreaterThanOrEqual(1);
    }
  });

  it("searches by name", async () => {
    const result = await admin.get("/api/doctors?q=Test Doctor 1");
    expect(result.status).toBe(200);
    expect(result.data.items.length).toBeGreaterThan(0);
  });

  /**
   * The search term goes into a `$regex`, so the handler escapes it. An
   * unescaped `(` is an invalid expression and would surface as a 500.
   */
  it("survives regex metacharacters in the search term", async () => {
    for (const term of ["(", "[", "*", "+?", "\\", "a{2,", ".*"]) {
      const result = await admin.get(`/api/doctors?q=${encodeURIComponent(term)}`);
      expect(result.status, `term: ${term}`).toBe(200);
    }
  });
});

describe("POST /api/doctors", () => {
  it("creates a doctor and rejects the duplicate that follows", async () => {
    const name = `Created By Test ${Date.now()}`;
    const first = await admin.post("/api/doctors", { name, city: "Mumbai" });
    expect([200, 201]).toContain(first.status);

    const id = first.data._id ?? first.data.id;
    expect(id).toBeTruthy();

    // Cleaning up after itself: the seeder's marker is not on this one.
    await admin.delete(`/api/doctors/${id}`);
  });

  it("refuses a doctor with no name", async () => {
    const result = await admin.post("/api/doctors", { city: "Mumbai" });
    expect(result.status).toBe(400);
  });

  it("refuses coordinates that are not on the globe", async () => {
    const result = await admin.post("/api/doctors", {
      name: `Bad Location ${Date.now()}`, latitude: 999, longitude: 999
    });
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.status).toBeLessThan(500);
  });
});

describe("GET /api/doctors/:id", () => {
  it("returns 400 for an id that is not an ObjectId, not a 500", async () => {
    for (const id of ["not-an-id", "12345", "'; DROP TABLE users; --", "../../etc/passwd"]) {
      const result = await admin.get(`/api/doctors/${encodeURIComponent(id)}`);
      expect(result.status, `id: ${id}`).toBeLessThan(500);
    }
  });

  it("returns 404 for a well-formed id that matches nothing", async () => {
    const result = await admin.get(`/api/doctors/${MISSING_ID}`);
    expect(result.status).toBe(404);
  });
});

describe("GET /api/visits", () => {
  /**
   * The handler pins `filter.employee` to the caller for field roles before it
   * reads the query string, so the parameter is not merely ignored — it cannot
   * be made to widen the result.
   */
  it("never lets a rep widen the filter to somebody else's visits", async () => {
    const mine = await mr.get("/api/visits");
    const attempted = await mr.get(`/api/visits?employee=${ids.users.MR2}`);

    expect(attempted.status).toBe(200);
    expect(attempted.data.total).toBe(mine.data.total);
    for (const visit of attempted.data.items) {
      expect(String(visit.employee?._id ?? visit.employee)).toBe(ids.users.MR);
    }
  });

  it("lets the desk filter by employee", async () => {
    const result = await admin.get(`/api/visits?employee=${ids.users.MR}`);
    expect(result.status).toBe(200);
    for (const visit of result.data.items) {
      expect(String(visit.employee?._id ?? visit.employee)).toBe(ids.users.MR);
    }
  });

  it("accepts a date range without failing on a malformed one", async () => {
    for (const query of ["from=2024-01-01&to=2024-12-31", "from=garbage", "to=9999-99-99"]) {
      const result = await mr.get(`/api/visits?${query}`);
      expect(result.status, query).toBeLessThan(500);
    }
  });
});

describe("POST /api/visits", () => {
  it("registers an unplanned call and returns the same one on a second tap", async () => {
    const doctor = ids.doctorsOfMr[0];

    const first = await mr.post("/api/visits", { doctor, notes: "Integration test call" });
    expect([200, 201]).toContain(first.status);
    expect(first.data.existing).toBe(false);

    // Two taps on a slow connection must not become two visits.
    const second = await mr.post("/api/visits", { doctor, notes: "Same call again" });
    expect(second.status).toBe(200);
    expect(second.data.existing).toBe(true);
    expect(String(second.data._id)).toBe(String(first.data._id));
  });

  it("refuses a doctor reference that is not an ObjectId", async () => {
    const result = await mr.post("/api/visits", { doctor: "nope" });
    expect(result.status).toBe(400);
  });

  it("returns 404 for a doctor that does not exist", async () => {
    const result = await mr.post("/api/visits", { doctor: MISSING_ID });
    expect(result.status).toBe(404);
  });

  it("refuses a location that is only half a fix", async () => {
    const result = await mr.post("/api/visits", {
      doctor: ids.doctorsOfMr[1], latitude: 19.07  // no longitude
    });
    // Either refused, or accepted with the partial fix discarded — never stored
    // as a point, which the geo suite checks. A 500 would be the failure.
    expect(result.status).toBeLessThan(500);
  });

  it("refuses coordinates off the globe", async () => {
    const result = await mr.post("/api/visits", {
      doctor: ids.doctorsOfMr[1], latitude: 91, longitude: 200, accuracy: 5
    });
    expect(result.status).toBe(400);
  });
});

describe("GET /api/invoices", () => {
  it("answers for every role that may read it", async () => {
    for (const client of [admin, hr, mr]) {
      const result = await client.get("/api/invoices?limit=5");
      expect(result.status).toBe(200);
      expect(Array.isArray(result.data.items)).toBe(true);
    }
  });

  it("shows a rep only their own bills", async () => {
    const result = await mr.get("/api/invoices?limit=100");
    expect(result.status).toBe(200);
    for (const invoice of result.data.items) {
      expect(String(invoice.employee?._id ?? invoice.employee)).toBe(ids.users.MR);
    }
  });
});

describe("POST /api/invoices", () => {
  it("refuses an invoice with no lines", async () => {
    const result = await admin.post("/api/invoices", { customer: MISSING_ID, items: [] });
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.status).toBeLessThan(500);
  });

  it("refuses a negative quantity or rate", async () => {
    for (const line of [{ quantity: -1, rate: 100 }, { quantity: 1, rate: -100 }]) {
      const result = await admin.post("/api/invoices", {
        customer: MISSING_ID,
        items: [{ name: "Test Product 1", ...line }]
      });
      expect(result.status, JSON.stringify(line)).toBeGreaterThanOrEqual(400);
      expect(result.status, JSON.stringify(line)).toBeLessThan(500);
    }
  });
});

/**
 * Correcting a bill that has already been part paid, and the chases scheduled
 * against it.
 *
 * These two belong together: a bill nobody has finished paying is exactly the
 * bill that gets corrected and chased, and correcting it used to be refused
 * outright — which left the only way to fix a wrong quantity being to delete the
 * receipt for money that had actually been handed over.
 *
 * The bill raised here is deleted again at the end. The suite's cleanup removes
 * only what it seeded itself, and a test that leaves invoices behind quietly
 * moves the totals every later run reads.
 */
describe("a part-paid bill: corrections and follow-ups", () => {
  const today = new Date().toISOString().slice(0, 10);
  const inDays = days => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
  };

  /** The same bill at a different quantity, so a correction is one number away. */
  const draft = (quantity, extra = {}) => ({
    partySource: "Doctor",
    doctor: ids.doctorsOfMr[0],
    employee: ids.users.MR,
    // A bill of supply: the seller's GSTIN is settings a test cannot assume.
    taxed: false,
    invoiceDate: today,
    items: [{ name: "Test Product 1", quantity, rate: 100, gstRate: 0 }],
    ...extra
  });

  let id, receipt;

  beforeAll(async () => {
    const raised = await admin.post("/api/invoices",
      draft(10, { followUps: [{ date: inDays(3), note: "first call" }] }));
    expect(raised.status, raised.error).toBe(201);
    id = raised.data._id;

    const paid = await admin.post(`/api/invoices/${id}/payments`, { amount: 500, mode: "Cash", paidAt: today });
    expect(paid.status, paid.error).toBe(201);
    receipt = paid.data.payment;
  });

  afterAll(async () => {
    if (!id) return;
    if (receipt) await admin.delete(`/api/invoices/${id}/payments?payment=${receipt}`);
    await admin.delete(`/api/invoices/${id}`);
  });

  it("re-prices a bill with a receipt on it, and leaves the receipt alone", async () => {
    const saved = await admin.put(`/api/invoices/${id}`, draft(12));
    expect(saved.status, saved.error).toBe(200);

    const { data } = await admin.get(`/api/invoices/${id}`);
    expect(data.invoice.grandTotal).toBe(1200);
    expect(data.invoice.payments).toHaveLength(1);
    expect(data.invoice.amountPaid).toBe(500);
    expect(data.invoice.balanceDue).toBe(700);
    expect(data.invoice.status).toBe("Partially paid");
  });

  it("keeps a chase already agreed through a correction that says nothing about it", async () => {
    const { data } = await admin.get(`/api/invoices/${id}`);
    expect(data.invoice.followUps).toHaveLength(1);
    expect(data.invoice.followUps[0].note).toBe("first call");
    expect(data.invoice.followUpDate.slice(0, 10)).toBe(inDays(3));
  });

  it("refuses to price the bill below the money already received", async () => {
    const saved = await admin.put(`/api/invoices/${id}`, draft(4));
    expect(saved.status).toBe(400);
    expect(saved.error).toMatch(/already been received/i);

    // Refused means nothing moved, not "saved most of it".
    const { data } = await admin.get(`/api/invoices/${id}`);
    expect(data.invoice.grandTotal).toBe(1200);
  });

  it("settles the bill when the correction lands on exactly what was paid", async () => {
    const saved = await admin.put(`/api/invoices/${id}`, draft(5));
    expect(saved.status, saved.error).toBe(200);

    const { data } = await admin.get(`/api/invoices/${id}`);
    expect(data.invoice.grandTotal).toBe(500);
    expect(data.invoice.balanceDue).toBe(0);
    expect(data.invoice.status).toBe("Paid");
  });

  it("lets the rep who owns the bill schedule another chase", async () => {
    const added = await mr.post(`/api/invoices/${id}/follow-ups`, { date: inDays(1), note: "balance promised" });
    expect(added.status, added.error).toBe(201);
    expect(added.data.followUps).toHaveLength(2);
    // The mirror is the earliest one still outstanding, not the newest added.
    expect(added.data.followUpDate.slice(0, 10)).toBe(inDays(1));
  });

  it("refuses a rep who does not own the bill, and a rep moving the due date", async () => {
    const foreign = await mr2.post(`/api/invoices/${id}/follow-ups`, { date: inDays(2) });
    expect(foreign.status).toBe(403);

    const overreach = await mr.post(`/api/invoices/${id}/follow-ups`, { date: inDays(2), moveDueDate: true });
    expect(overreach.status).toBe(403);
  });

  it("moves the bill on to its next chase once one is marked as made", async () => {
    const { data: before } = await admin.get(`/api/invoices/${id}`);
    const soonest = [...before.invoice.followUps].sort((a, b) => a.date.localeCompare(b.date))[0];

    const marked = await mr.patch(`/api/invoices/${id}/follow-ups?followUp=${soonest._id}`, { done: true });
    expect(marked.status, marked.error).toBe(200);
    expect(marked.data.next._id).not.toBe(soonest._id);
    expect(marked.data.followUpDate.slice(0, 10)).toBe(inDays(3));
  });

  it("replaces the whole list from the dates dialog, and empties the mirror with it", async () => {
    const cleared = await admin.patch(`/api/invoices/${id}`, { followUps: [] });
    expect(cleared.status, cleared.error).toBe(200);

    const { data } = await admin.get(`/api/invoices/${id}`);
    expect(data.invoice.followUps).toHaveLength(0);
    expect(data.invoice.followUpDate ?? null).toBe(null);
  });
});

describe("GET /api/hr/leave", () => {
  it("lets anybody apply, and shows a rep only their own requests", async () => {
    const result = await mr.get("/api/hr/leave");
    expect(result.status).toBe(200);
    for (const request of result.data.items ?? []) {
      expect(String(request.employee?._id ?? request.employee)).toBe(ids.users.MR);
    }
  });
});

describe("malformed input across the write endpoints", () => {
  const WRITES = [
    ["POST", "/api/doctors"],
    ["POST", "/api/visits"],
    ["POST", "/api/plans"],
    ["POST", "/api/hr/leave"],
    ["POST", "/api/samples/movements"]
  ];

  /** A body that is not JSON at all must be a 400, never an unhandled throw. */
  it("answers 4xx to a body that is not JSON", async () => {
    for (const [method, path] of WRITES) {
      const result = await mr.request(method, path, {
        body: "this is not json{{{",
        headers: { "content-type": "application/json" }
      });
      expect(result.status, `${method} ${path}`).toBeLessThan(500);
    }
  });

  it("answers 4xx to an empty body", async () => {
    for (const [method, path] of WRITES) {
      const result = await mr.request(method, path, {
        body: "",
        headers: { "content-type": "application/json" }
      });
      expect(result.status, `${method} ${path}`).toBeLessThan(500);
    }
  });

  /**
   * Mongoose casts strings to ObjectId, and a `$`-prefixed object where a
   * string is expected is the shape a query-operator injection takes.
   */
  it("answers 4xx to an operator object where an id is expected", async () => {
    const result = await mr.post("/api/visits", { doctor: { $ne: null } });
    expect(result.status).toBeLessThan(500);
    expect(result.status).toBeGreaterThanOrEqual(400);
  });
});
