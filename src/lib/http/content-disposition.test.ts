import { describe, expect, it } from "vitest";
import { contentDisposition } from "./content-disposition";

describe("contentDisposition", () => {
  it("sends a plain name once", () => {
    expect(contentDisposition("invoice.pdf")).toBe('attachment; filename="invoice.pdf"');
  });

  it("sends a name with anything above 255 twice", () => {
    // The bug this exists for: a header value is a ByteString, and Node throws
    // rather than mangling the name — so an em dash in a file name turned a
    // download into a 500 with nothing in it to explain why.
    const header = contentDisposition("Bhealix — Aug 2026.zip");
    expect(header).toContain('filename="Bhealix - Aug 2026.zip"');
    expect(header).toContain("filename*=UTF-8''Bhealix%20%E2%80%94%20Aug%202026.zip");
  });

  it("produces a value a header can actually carry", () => {
    for (const name of ["भुगतान.pdf", "₹1,180 receipt.pdf", "Meta — 2026‑08.pdf"]) {
      const header = contentDisposition(name);
      expect(/^[\x00-\xff]*$/.test(header), `${name} produced a header with a wide character`).toBe(true);
    }
  });

  it("cannot be made to end the quoted string early", () => {
    // A quote or a backslash in the name would otherwise close `filename="…"`
    // and let the rest be read as further header parameters.
    expect(contentDisposition('a"b\\c.pdf')).toContain('filename="a-b-c.pdf"');
  });

  it("never produces an empty name", () => {
    expect(contentDisposition("भुगतान")).toContain('filename="download"');
  });

  it("says inline when the file is meant to be looked at rather than saved", () => {
    expect(contentDisposition("proof.jpg", "inline")).toBe('inline; filename="proof.jpg"');
  });
});
