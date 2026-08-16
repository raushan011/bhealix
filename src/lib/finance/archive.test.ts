import { describe, expect, it } from "vitest";
import { archiveEntries, archiveFileName, entryNameFor, manifestCsv } from "./archive";
import type { ArchivableDocument } from "./archive";

const document = (over: Partial<ArchivableDocument> = {}): ArchivableDocument => ({
  period: "2026-08",
  source: "razorpay",
  fileName: "invoice.pdf",
  contentType: "application/pdf",
  bytes: 1024,
  origin: "uploaded",
  ...over
});

describe("entryNameFor", () => {
  it("files each vendor in its own folder", () => {
    expect(entryNameFor(document({ source: "shiprocket-recharge" }))).toMatch(/^Shiprocket\//);
    expect(entryNameFor(document({ source: "meta-ads" }))).toMatch(/^Meta\//);
  });

  it("names the file after the month and the document, not after the vendor's own name for it", () => {
    // Shiprocket calls every invoice `invoice.pdf` and Meta calls every receipt
    // `Receipt.pdf`. A folder of those identifies nothing and, worse, collides.
    expect(entryNameFor(document({ number: "RZP-4471" })))
      .toBe("Razorpay/2026-08 — Gateway fees — RZP-4471.pdf");
  });

  it("falls back to the description when there is no number", () => {
    expect(entryNameFor(document({ description: "August fees" })))
      .toBe("Razorpay/2026-08 — Gateway fees — August fees.pdf");
  });

  it("keeps the extension the bytes actually are", () => {
    expect(entryNameFor(document({ fileName: "ledger.csv", contentType: "text/csv" }))).toMatch(/\.csv$/);
    // A file saved without an extension still gets one from its type, so it
    // opens by double-click after extraction.
    expect(entryNameFor(document({ fileName: "scan", contentType: "image/jpeg" }))).toMatch(/\.jpg$/);
  });
});

describe("archiveFileName", () => {
  it("names one month, a span, and a vendor's slice of one", () => {
    expect(archiveFileName(["2026-08"])).toBe("Bhealix vendor invoices — Aug 2026.zip");
    expect(archiveFileName(["2026-08", "2026-06"])).toBe("Bhealix vendor invoices — Jun 2026 to Aug 2026.zip");
    expect(archiveFileName(["2026-08"], "Shiprocket")).toBe("Bhealix Shiprocket vendor invoices — Aug 2026.zip");
  });
});

describe("manifestCsv", () => {
  const rows = [
    { ...document({ number: "RZP-1", amount: 1180, taxAmount: 180, documentDate: new Date("2026-08-04T00:00:00Z") }), entryName: "Razorpay/a.pdf" },
    { ...document({ source: "meta-ads", description: 'Ads, "August" run', origin: "pulled" }), entryName: "Meta/b.pdf" }
  ];

  it("leads with a BOM so Excel reads it as UTF-8", () => {
    // Without one, Excel decodes a UTF-8 CSV as Windows-1252 and every rupee
    // sign and em dash in it becomes mojibake.
    expect(manifestCsv(rows).toString("utf8").startsWith("﻿")).toBe(true);
  });

  it("quotes a field containing a comma or a quote so the columns hold", () => {
    const csv = manifestCsv(rows).toString("utf8");
    expect(csv).toContain('"Ads, ""August"" run"');
  });

  it("carries the figures and says how each file got there", () => {
    const csv = manifestCsv(rows).toString("utf8");
    expect(csv).toContain("August 2026,Razorpay,Gateway fees,RZP-1,2026-08-04,1180,180,INR");
    expect(csv).toContain("Pulled automatically");
    expect(csv).toContain("Uploaded by hand");
  });
});

describe("archiveEntries", () => {
  it("puts the index first, so it is the first thing in the extracted folder", () => {
    const entries = archiveEntries([document(), document()], () => new Uint8Array([1]));
    expect(entries[0].name).toBe("Contents.csv");
    expect(entries).toHaveLength(3);
  });

  it("gives two indistinguishable invoices two names", () => {
    // Two Razorpay bills for the same month with no number between them is an
    // ordinary state of affairs, and a ZIP with two identical entries extracts
    // as one file — silently, with the second overwriting the first.
    const entries = archiveEntries([document(), document()], () => new Uint8Array([1]));
    expect(entries[1].name).not.toBe(entries[2].name);
  });

  it("asks for each file's bytes by position, so nothing is held twice", () => {
    const asked: number[] = [];
    archiveEntries([document(), document()], index => { asked.push(index); return new Uint8Array([index]); });
    expect(asked).toEqual([0, 1]);
  });
});
