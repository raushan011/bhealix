/**
 * Can one representative reach another representative's records?
 *
 * This is the failure mode a field CRM is most exposed to. Every rep is a
 * legitimate, authenticated user, so nothing here is stopped by the session
 * guard — the only thing standing between them is each handler remembering to
 * compare the record's owner against the caller. A missed comparison is not a
 * crash; it silently returns somebody else's visits, bills and photographs.
 *
 * Each test creates the record as one rep and reaches for it as the other.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { as } from "../support/client.mjs";
import { fixtures, MISSING_ID } from "../support/fixtures.mjs";
import { photoForm, TINY_PNG } from "../support/photo.mjs";

let ids, mr, mr2, admin, hr;

/** A visit belonging to MR2, created fresh so the test owns its own fixture. */
let victimVisitId;

beforeAll(async () => {
  ids = fixtures();
  [mr, mr2, admin, hr] = await Promise.all([as("MR"), as("MR2"), as("ADMIN"), as("HR")]);

  const created = await mr2.post("/api/visits", {
    doctor: ids.doctorsOfMr2[0],
    notes: "Belongs to the other rep"
  });
  victimVisitId = String(created.data._id);
});

describe("visits", () => {
  it("does not list another rep's visits", async () => {
    const mine = await mr.get("/api/visits?limit=100");
    const ownVisitIds = mine.data.items.map(visit => String(visit._id));
    expect(ownVisitIds).not.toContain(victimVisitId);
  });

  it("refuses to update another rep's visit", async () => {
    const result = await mr.patch(`/api/visits/${victimVisitId}`, { notes: "I was never here" });
    expect(result.status, `got ${result.status}: ${result.error ?? ""}`).toBe(403);
  });

  it("refuses to read the photos on another rep's visit", async () => {
    const result = await mr.get(`/api/visits/${victimVisitId}/photos`);
    expect(result.status).toBe(403);
  });

  it("refuses to attach a photo to another rep's visit", async () => {
    const result = await mr.request("POST", `/api/visits/${victimVisitId}/photos`, {
      body: photoForm([["intruder.png", "image/png", TINY_PNG]])
    });
    expect(result.status).toBe(403);
  });

  it("lets the desk read what a rep may not", async () => {
    const result = await admin.get(`/api/visits/${victimVisitId}/photos`);
    expect(result.status).toBeLessThan(400);
  });
});

describe("invoices", () => {
  it("does not list another rep's bills", async () => {
    const listed = await mr.get("/api/invoices?limit=100");
    for (const invoice of listed.data.items) {
      expect(String(invoice.employee?._id ?? invoice.employee)).toBe(ids.users.MR);
    }
  });

  /**
   * The payment route is the sharpest edge in the file: recording a receipt
   * against a bill that is not yours writes money into somebody else's ledger.
   */
  it("refuses to record a payment against another rep's bill", async () => {
    const bills = await admin.get("/api/invoices?limit=100");
    const foreign = bills.data.items?.find(
      invoice => String(invoice.employee?._id ?? invoice.employee) !== ids.users.MR
    );
    if (!foreign) return; // No foreign bill exists in this database; nothing to prove.

    const result = await mr.post(`/api/invoices/${foreign._id}/payments`, {
      amount: 1, mode: "Cash"
    });
    expect(result.status).toBe(403);
  });
});

describe("employee records", () => {
  it("refuses to read another employee's profile", async () => {
    const result = await mr.get(`/api/team/${ids.users.MR2}`);
    expect(result.status).toBe(403);
  });

  it("refuses to read another employee's salary", async () => {
    const result = await mr.get(`/api/hr/salary/${ids.users.MR2}`);
    expect(result.status).toBe(403);
  });

  it("allows reading one's own profile and salary", async () => {
    expect((await mr.get(`/api/team/${ids.users.MR}`)).status).toBeLessThan(400);
    expect((await mr.get(`/api/hr/salary/${ids.users.MR}`)).status).toBeLessThan(400);
  });

  it("refuses to edit one's own role", async () => {
    const result = await mr.patch(`/api/team/${ids.users.MR}`, { role: "ADMIN" });
    expect(result.status).toBe(403);
  });
});

describe("leave", () => {
  /**
   * Approving leave is `manageLeave`, and the handler additionally refuses
   * somebody approving their own — one person who can both ask and grant is a
   * hole regardless of role.
   */
  it("refuses a rep approving any leave request", async () => {
    const applied = await mr.post("/api/hr/leave", {
      type: "Casual", from: "2030-01-01", to: "2030-01-02", reason: "Integration test"
    });
    if (applied.status >= 400) return;

    const id = String(applied.data._id ?? applied.data.id);
    const result = await mr.patch(`/api/hr/leave/${id}`, { status: "Approved" });
    expect(result.status).toBe(403);
  });
});

describe("mass assignment", () => {
  /**
   * A create endpoint that spreads the request body into the document lets a
   * caller set fields the form never offered — here, whose record it is.
   */
  it("does not let a rep create a visit owned by somebody else", async () => {
    const created = await mr.post("/api/visits", {
      doctor: ids.doctorsOfMr[2],
      employee: ids.users.MR2,      // not a field the schema accepts from the client
      notes: "Ownership attempt"
    });

    if (created.status >= 400) return; // Refused outright is also correct.

    const readBack = await admin.get(`/api/visits?limit=100&employee=${ids.users.MR}`);
    const mine = readBack.data.items.map(visit => String(visit._id));
    expect(mine, "the visit was created under the other rep's name").toContain(String(created.data._id));
  });

  it("does not let a rep promote themselves while editing a doctor", async () => {
    // Doctors are admin-only to edit, so this must be refused on the guard alone.
    const result = await mr.patch(`/api/doctors/${ids.doctorsOfMr[0]}`, { assignedTo: ids.users.MR });
    expect(result.status).toBe(403);
  });
});

describe("id handling", () => {
  it("answers 4xx, never 5xx, to hostile id shapes", async () => {
    const hostile = [
      "../../../etc/passwd", "%2e%2e%2f", "null", "undefined",
      '{"$ne":null}', "0".repeat(500), "<script>alert(1)</script>"
    ];

    for (const id of hostile) {
      for (const path of [`/api/visits/${encodeURIComponent(id)}`, `/api/team/${encodeURIComponent(id)}`]) {
        const result = await mr.get(path);
        expect(result.status, `${path}`).toBeLessThan(500);
      }
    }
  });

  it("does not distinguish a record that exists from one that does not, to a caller who may not see it", async () => {
    const missing = await mr.get(`/api/team/${MISSING_ID}`);
    const existing = await mr.get(`/api/team/${ids.users.MR2}`);
    // Both must be refusals. A 404 for one and 403 for the other tells an
    // attacker which employee ids are real.
    expect(missing.status).toBe(existing.status);
  });
});
