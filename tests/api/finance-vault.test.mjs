import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inflateRawSync } from "node:zlib";
import { anonymous, as } from "../support/client.mjs";

/**
 * The vendor invoice vault, end to end against a real server and a real
 * database.
 *
 * The unit tests already prove the ZIP writer produces a readable archive and
 * the period helpers land on the right month. What only a running server can
 * show is the part that matters on the day the accountant asks: that a file
 * uploaded through the form comes back out of the archive byte for byte, that
 * the checklist notices what is missing, and that nobody but the super
 * administrator can see any of it.
 */

/**
 * A month far enough in the past that nothing real is filed against it, so the
 * assertions about counts and totals are about this test's documents and
 * nothing else.
 */
const PERIOD = "2019-03";

const PDF = Buffer.from("%PDF-1.4\n% a vendor invoice\ntrailer<</Root 1 0 R>>\n%%EOF\n");

/** Reads a ZIP the way an unzip does — from the end, following the offsets. */
function readZip(archive) {
  const end = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = archive.readUInt16LE(end + 10);
  let cursor = archive.readUInt32LE(end + 16);
  const files = [];

  for (let index = 0; index < count; index++) {
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const name = archive.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    const localAt = archive.readUInt32LE(cursor + 42);

    const method = archive.readUInt16LE(localAt + 8);
    const compressed = archive.readUInt32LE(localAt + 18);
    const start = localAt + 30 + archive.readUInt16LE(localAt + 26) + archive.readUInt16LE(localAt + 28);
    const body = archive.subarray(start, start + compressed);

    files.push({ name, data: method === 8 ? inflateRawSync(body) : body });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

function upload({ source, number, amount, taxAmount, documentDate, fileName = "invoice.pdf", bytes = PDF }) {
  const form = new FormData();
  form.set("file", new File([bytes], fileName, { type: "application/pdf" }));
  form.set("period", PERIOD);
  form.set("source", source);
  if (number) form.set("number", number);
  if (amount != null) form.set("amount", String(amount));
  if (taxAmount != null) form.set("taxAmount", String(taxAmount));
  if (documentDate) form.set("documentDate", documentDate);
  return form;
}

describe("the vendor invoice vault", () => {
  let sup;
  const filed = [];

  beforeAll(async () => {
    sup = await as("SUPERADMIN");
  });

  // The suite's own litter, removed through the same route a person would use.
  afterAll(async () => {
    for (const id of filed) await sup.delete(`/api/finance/documents/${id}`);
  });

  it("is closed to everybody but the super administrator", async () => {
    expect((await anonymous().get(`/api/finance/documents?period=${PERIOD}`)).status).toBe(401);

    for (const role of ["ADMIN", "HR", "MR"]) {
      const client = await as(role);
      const read = await client.get(`/api/finance/documents?period=${PERIOD}`);
      const archive = await client.get(`/api/finance/archive?period=${PERIOD}`);
      expect(read.status, `${role} could read the vault`).toBe(403);
      expect(archive.status, `${role} could download the archive`).toBe(403);
    }
  });

  it("starts the month empty, and names what is missing", async () => {
    const { status, data } = await sup.get(`/api/finance/documents?period=${PERIOD}`);
    expect(status).toBe(200);
    expect(data.documents).toEqual([]);
    // Every expected source, listed as missing. The one source that is not
    // expected — offline bills — is deliberately absent from this list.
    expect(data.summary.missing).toEqual([
      "shiprocket-recharge", "shiprocket-order", "shiprocket-checkout", "razorpay", "shopify", "meta-ads"
    ]);
  });

  it("files an uploaded invoice and counts it against its source", async () => {
    const posted = await sup.post("/api/finance/documents",
      upload({ source: "razorpay", number: "RZP-TEST-1", amount: 1180, taxAmount: 180, documentDate: `${PERIOD}-04` }));

    expect(posted.status).toBe(201);
    expect(posted.data.document.source).toBe("razorpay");
    expect(posted.data.document.origin).toBe("uploaded");
    expect(posted.data.document.bytes).toBe(PDF.length);
    filed.push(posted.data.document.id);

    const { data } = await sup.get(`/api/finance/documents?period=${PERIOD}`);
    expect(data.summary.amount).toBe(1180);
    expect(data.summary.taxAmount).toBe(180);
    expect(data.summary.missing).not.toContain("razorpay");
    expect(data.summary.lines.find(line => line.source === "razorpay").count).toBe(1);
  });

  it("says so when a bill is filed under a month it is not dated in", async () => {
    // Ordinary and usually correct — a Meta receipt dated the 2nd of September
    // is August's advertising — so it is a note, not a refusal.
    const posted = await sup.post("/api/finance/documents",
      upload({ source: "meta-ads", number: "META-TEST-1", amount: 5000, documentDate: "2019-04-02" }));

    expect(posted.status).toBe(201);
    expect(posted.data.note).toMatch(/2019-04-02/);
    filed.push(posted.data.document.id);
  });

  it("refuses a file it cannot store", async () => {
    const form = new FormData();
    form.set("file", new File([Buffer.from("<script>")], "payload.html", { type: "text/html" }));
    form.set("period", PERIOD);
    form.set("source", "other");

    const posted = await sup.post("/api/finance/documents", form);
    expect(posted.status).toBe(400);
    expect(posted.error).toMatch(/PDF/i);
  });

  it("refuses a month that is not a month", async () => {
    const bad = new FormData();
    bad.set("file", new File([PDF], "x.pdf", { type: "application/pdf" }));
    bad.set("period", "2019-13");
    bad.set("source", "other");
    expect((await sup.post("/api/finance/documents", bad)).status).toBe(400);
  });

  it("takes a bill with no figure on it, because the file is the record", async () => {
    // A form that refuses an invoice until somebody has read the tax off it is
    // a form that ends with the invoice still sitting in the Downloads folder.
    const posted = await sup.post("/api/finance/documents", upload({ source: "other" }));
    expect(posted.status).toBe(201);
    expect(posted.data.document.amount).toBeUndefined();
    filed.push(posted.data.document.id);
  });

  it("hands the file back exactly as it went in", async () => {
    const { status, headers, response } = await sup.get(`/api/finance/documents/${filed[0]}?download=1`, { raw: true });
    expect(status).toBe(200);
    expect(headers.get("content-type")).toBe("application/pdf");
    // Named after the month and the document, not after the vendor's `invoice.pdf`.
    expect(headers.get("content-disposition")).toContain("RZP-TEST-1");
    expect(Buffer.from(await response.arrayBuffer()).equals(PDF)).toBe(true);
  });

  it("puts the whole month in one archive, with an index", async () => {
    const { status, headers, response } = await sup.get(`/api/finance/archive?period=${PERIOD}`, { raw: true });
    expect(status).toBe(200);
    expect(headers.get("content-type")).toBe("application/zip");
    expect(headers.get("content-disposition")).toContain("Mar 2019");

    const files = readZip(Buffer.from(await response.arrayBuffer()));
    expect(files[0].name).toBe("Contents.csv");
    expect(files).toHaveLength(filed.length + 1);

    // A folder per vendor, which is how the reconciliation is done.
    expect(files.some(file => file.name.startsWith("Razorpay/"))).toBe(true);
    expect(files.some(file => file.name.startsWith("Meta/"))).toBe(true);

    // The bytes survive the round trip through the archive.
    const razorpay = files.find(file => file.name.startsWith("Razorpay/"));
    expect(razorpay.data.equals(PDF)).toBe(true);

    // And the index carries the figures somebody will total.
    const manifest = files[0].data.toString("utf8");
    expect(manifest).toContain("RZP-TEST-1");
    expect(manifest).toContain("1180");
  });

  it("archives one vendor's slice of the month", async () => {
    const { status, response } = await sup.get(
      `/api/finance/archive?period=${PERIOD}&vendor=Razorpay`, { raw: true });
    expect(status).toBe(200);

    const files = readZip(Buffer.from(await response.arrayBuffer()));
    expect(files.filter(file => file.name !== "Contents.csv").every(file => file.name.startsWith("Razorpay/"))).toBe(true);
  });

  it("archives only what was ticked", async () => {
    const { status, response } = await sup.get(`/api/finance/archive?ids=${filed[0]}`, { raw: true });
    expect(status).toBe(200);
    expect(readZip(Buffer.from(await response.arrayBuffer()))).toHaveLength(2);
  });

  it("asks before marking an incomplete month sent, then does it", async () => {
    const asked = await sup.patch("/api/finance/periods", { period: PERIOD, handedOver: true });
    expect(asked.status).toBe(200);
    expect(asked.data.confirm).toBe(true);
    expect(asked.data.message).toMatch(/Shiprocket/);

    const done = await sup.patch("/api/finance/periods", { period: PERIOD, handedOver: true, force: true });
    expect(done.data.summary.handedOverAt).toBeTruthy();
    expect(done.data.summary.handedOverBy).toBe("Test Super");

    const reopened = await sup.patch("/api/finance/periods", { period: PERIOD, handedOver: false });
    expect(reopened.data.summary.handedOverAt).toBeUndefined();
  });

  it("declines to invent a sync for a supplier that has no API", async () => {
    // The important refusal. A "sync" that ran and filed nothing would leave the
    // month looking synced and empty, which reads exactly like a month with no
    // bills in it.
    const pulled = await sup.post("/api/finance/pull", { period: PERIOD, source: "razorpay" });
    expect(pulled.status).toBe(400);
    expect(pulled.error).toMatch(/dashboard/i);
  });

  it("deletes a document, and the file with it", async () => {
    const spare = await sup.post("/api/finance/documents", upload({ source: "shopify", number: "SHOP-TEST-1" }));
    const id = spare.data.document.id;

    expect((await sup.delete(`/api/finance/documents/${id}`)).status).toBe(200);
    expect((await sup.get(`/api/finance/documents/${id}`)).status).toBe(404);
  });
});

/**
 * Panel grants, which are the other half of the super admin panel — and the
 * half where getting it wrong locks somebody out of their own work.
 */
describe("panel access", () => {
  let sup;
  let adminId;

  beforeAll(async () => {
    sup = await as("SUPERADMIN");
    const { data } = await sup.get("/api/control/access");
    adminId = data.accounts.find(account => account.role === "ADMIN").id;
  });

  // Left as it was found: an explicit grant of both, which behaves identically
  // to the role default the other tests assume.
  afterAll(async () => {
    await sup.patch("/api/control/access", { userId: adminId, workspaces: ["doctor", "sales"] });
  });

  it("is the super administrator's alone", async () => {
    for (const role of ["ADMIN", "HR"]) {
      const client = await as(role);
      expect((await client.get("/api/control/access")).status).toBe(403);
      expect((await client.patch("/api/control/access", { userId: adminId, workspaces: [] })).status).toBe(403);
    }
  });

  it("lists desk accounts and leaves field staff out of it", async () => {
    const { data } = await sup.get("/api/control/access");
    const roles = new Set(data.accounts.map(account => account.role));
    expect(roles.has("ADMIN")).toBe(true);
    expect(roles.has("MR")).toBe(false);
    expect(roles.has("SALES")).toBe(false);
    // Only the two CRMs can be handed out.
    expect(data.workspaces.map(workspace => workspace.key)).toEqual(["doctor", "sales"]);
  });

  it("closes the API behind a withdrawn panel at once, not at the next sign-in", async () => {
    const admin = await as("ADMIN");
    // Signed in while they still held it.
    expect((await admin.get("/api/sales/overview")).status).toBe(200);

    await sup.patch("/api/control/access", { userId: adminId, workspaces: ["doctor"] });

    // Same cookie, same session, no re-login — and the panel is shut.
    const after = await admin.get("/api/sales/overview");
    expect(after.status).toBe(403);
    expect(after.error).toMatch(/Sales CRM/);

    // The panel they kept is untouched.
    expect((await admin.get("/api/doctors?limit=1")).status).toBe(200);
  });

  it("sends somebody whose panel was withdrawn to one they still hold", async () => {
    const admin = await as("ADMIN");
    const page = await admin.get("/admin/sales", { raw: true });
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toMatch(/\/admin$/);
  });

  it("refuses to withdraw a super administrator's own panels", async () => {
    const { data } = await sup.get("/api/control/access");
    const self = data.accounts.find(account => account.role === "SUPERADMIN");
    expect(self.locked).toBe(true);

    const refused = await sup.patch("/api/control/access", { userId: self.id, workspaces: [] });
    expect(refused.status).toBe(400);
    expect(refused.error).toMatch(/by their role/);
  });

  it("will not grant the super admin panel itself", async () => {
    const refused = await sup.patch("/api/control/access", { userId: adminId, workspaces: ["doctor", "control"] });
    expect(refused.status).toBe(400);
    expect(refused.error).toMatch(/Doctor CRM and the Sales CRM/);
  });
});
