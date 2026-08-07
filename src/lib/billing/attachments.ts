/**
 * The two files billing keeps: the QR a doctor scans to pay, and the proof of a
 * payment once they have. Free of Mongoose and of React, so the browser can
 * refuse an oversized file before spending a rep's mobile data sending it and
 * the routes can refuse the same file again on arrival.
 */

/**
 * The company's payment QR — a UPI code, saved out of a banking app and
 * uploaded once. Images only: it is printed inside a box on the bill, not
 * opened, so a PDF has nothing to offer here.
 */
export const QR_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** A QR is a few kilobytes of black squares. A megabyte is already generous. */
export const MAX_QR_BYTES = 1024 * 1024;

/**
 * Proof of a receipt: a UPI screenshot, a photograph of a cheque, or a bank
 * advice saved as PDF. Unlike the QR this is evidence somebody opens and reads,
 * so a PDF is allowed alongside the pictures.
 */
export const PROOF_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;

/** Room for a bank statement page; still small enough to send from a corridor. */
export const MAX_PROOF_BYTES = 5 * 1024 * 1024;

export const isPdf = (contentType?: string) => contentType === "application/pdf";

export const FILE_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf"
};

/** "820 KB", "1.4 MB" — the size as somebody would say it out loud. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  return kb < 1024 ? `${Math.round(kb)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

/** The megabyte ceiling as a sentence, so both sides word the refusal the same. */
export const sizeLimitText = (limit: number) =>
  `under ${Math.round(limit / (1024 * 1024))} MB`;
