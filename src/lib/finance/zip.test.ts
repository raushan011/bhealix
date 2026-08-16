import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createZip, crc32, safeEntryName, uniqueEntryName } from "./zip";

/**
 * The archive is read back the way an unzip reads it — from the end of central
 * directory record backwards — rather than by trusting the offsets that were
 * written. Anything that puts a file at the wrong offset produces a ZIP that
 * every tool refuses and no assertion about the bytes going in would catch.
 */
function readZip(archive: Buffer) {
  const end = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(end).toBeGreaterThan(-1);

  const count = archive.readUInt16LE(end + 10);
  let cursor = archive.readUInt32LE(end + 16);
  const files: { name: string; data: Buffer }[] = [];

  for (let index = 0; index < count; index++) {
    expect(archive.readUInt32LE(cursor)).toBe(0x02014b50);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const name = archive.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    const localAt = archive.readUInt32LE(cursor + 42);

    // Follow the offset into the local header and read the payload from there.
    expect(archive.readUInt32LE(localAt)).toBe(0x04034b50);
    const method = archive.readUInt16LE(localAt + 8);
    const crc = archive.readUInt32LE(localAt + 14);
    const compressed = archive.readUInt32LE(localAt + 18);
    const localNameLength = archive.readUInt16LE(localAt + 26);
    const localExtraLength = archive.readUInt16LE(localAt + 28);
    const start = localAt + 30 + localNameLength + localExtraLength;
    const body = archive.subarray(start, start + compressed);

    const data = method === 8 ? inflateRawSync(body) : body;
    expect(crc32(data)).toBe(crc);
    files.push({ name, data });

    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return files;
}

describe("createZip", () => {
  it("writes an archive that reads back exactly as it went in", () => {
    const files = readZip(createZip([
      { name: "August 2026/razorpay.pdf", data: Buffer.from("%PDF-1.4 gateway fees") },
      { name: "August 2026/meta.txt", data: Buffer.from("a".repeat(500)) }
    ]));

    expect(files.map(file => file.name)).toEqual(["August 2026/razorpay.pdf", "August 2026/meta.txt"]);
    expect(files[0].data.toString()).toBe("%PDF-1.4 gateway fees");
    expect(files[1].data.toString()).toBe("a".repeat(500));
  });

  it("stores what is already compressed and deflates what is not", () => {
    const archive = createZip([
      { name: "invoice.pdf", data: Buffer.from("x".repeat(4000)) },
      { name: "ledger.csv", data: Buffer.from("x".repeat(4000)) }
    ]);
    // Both hold the same 4000 bytes; only the CSV is worth deflating, so the
    // archive has to be well short of twice that.
    expect(archive.length).toBeGreaterThan(4000);
    expect(archive.length).toBeLessThan(5000);
    expect(readZip(archive).every(file => file.data.length === 4000)).toBe(true);
  });

  it("survives an empty archive", () => {
    // A month with nothing filed still produces a downloadable file rather than
    // a zero-byte response the browser saves and cannot open.
    expect(readZip(createZip([]))).toEqual([]);
  });

  it("keeps non-ASCII names intact", () => {
    const [file] = readZip(createZip([{ name: "Shiprocket — wallet ₹.pdf", data: Buffer.from("x") }]));
    expect(file.name).toBe("Shiprocket — wallet ₹.pdf");
  });
});

describe("safeEntryName", () => {
  it("strips what a filesystem will not take", () => {
    expect(safeEntryName('INV:2026/08*"?.pdf')).toBe("INV-2026/08-.pdf");
  });

  it("refuses to write outside the folder somebody extracted into", () => {
    expect(safeEntryName("../../etc/passwd")).toBe("etc/passwd");
    expect(safeEntryName("/absolute/path.pdf")).toBe("absolute/path.pdf");
  });

  it("never returns an empty name", () => {
    expect(safeEntryName("   ")).toBe("file");
    expect(safeEntryName("..")).toBe("file");
  });
});

describe("uniqueEntryName", () => {
  it("keeps a repeated name from silently overwriting the first one", () => {
    const taken = new Set<string>();
    expect(uniqueEntryName("invoice.pdf", taken)).toBe("invoice.pdf");
    expect(uniqueEntryName("invoice.pdf", taken)).toBe("invoice (2).pdf");
    expect(uniqueEntryName("invoice.pdf", taken)).toBe("invoice (3).pdf");
  });

  it("suffixes before the extension so the file still opens", () => {
    const taken = new Set(["report.pdf"]);
    expect(uniqueEntryName("report.pdf", taken)).toBe("report (2).pdf");
  });

  it("treats names differing only in case as the same, as Windows does", () => {
    const taken = new Set<string>();
    uniqueEntryName("Invoice.pdf", taken);
    expect(uniqueEntryName("invoice.pdf", taken)).toBe("invoice (2).pdf");
  });
});
