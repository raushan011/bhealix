import { describe, expect, it } from "vitest";
import {
  formatBytes, isPdf, MAX_PROOF_BYTES, MAX_QR_BYTES, PROOF_TYPES, QR_TYPES, sizeLimitText
} from "./attachments";

describe("what billing accepts", () => {
  /**
   * The QR is printed inside a box on the bill. A PDF has nothing to offer
   * there, and letting one through would leave a blank square on the sheet.
   */
  it("takes a picture for the QR and a picture or a PDF for a proof", () => {
    expect(QR_TYPES).not.toContain("application/pdf");
    expect(PROOF_TYPES).toContain("application/pdf");
    for (const type of QR_TYPES) expect(PROOF_TYPES).toContain(type);
  });

  it("gives a proof more room than a QR — one is a screenshot, the other a few squares", () => {
    expect(MAX_QR_BYTES).toBeLessThan(MAX_PROOF_BYTES);
  });

  it("knows a PDF from a picture, and is not fooled by a missing type", () => {
    expect(isPdf("application/pdf")).toBe(true);
    expect(isPdf("image/png")).toBe(false);
    expect(isPdf(undefined)).toBe(false);
  });
});

describe("saying how big a file is", () => {
  it("reads the way somebody would say it out loud", () => {
    expect(formatBytes(820)).toBe("820 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(320 * 1024)).toBe("320 KB");
    expect(formatBytes(1536 * 1024)).toBe("1.5 MB");
  });

  /** The browser refuses a file and the server refuses it again; both must word it the same. */
  it("words the ceiling identically wherever it is refused", () => {
    expect(sizeLimitText(MAX_PROOF_BYTES)).toBe("under 5 MB");
    expect(sizeLimitText(MAX_QR_BYTES)).toBe("under 1 MB");
  });
});
