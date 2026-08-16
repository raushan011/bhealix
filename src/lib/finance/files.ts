/**
 * What the vault will accept, and what a file is called once it is in there.
 *
 * Free of Mongoose and of React, so the browser can refuse an impossible upload
 * before spending anybody's connection on it, the route can refuse the same file
 * again on arrival, and the schema can constrain the stored value — three places
 * that must agree and would otherwise agree by coincidence.
 */

/**
 * A vendor bill is a PDF nine times in ten. The images are for the tenth: a
 * photograph of a paper receipt, or a screenshot of a dashboard page that offers
 * no download at all — which is how Meta's billing has behaved more than once.
 *
 * Spreadsheets are here because Razorpay and Shiprocket both hand out their
 * transaction detail as CSV or XLSX, and the accountant wants that alongside the
 * invoice rather than instead of it.
 */
export const VAULT_FILE_TYPES = [
  "application/pdf",
  "image/jpeg", "image/png", "image/webp",
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
] as const;

export type VaultFileType = (typeof VAULT_FILE_TYPES)[number];

/** Generous — a scanned multi-page invoice is heavier than a payment screenshot. */
export const MAX_VAULT_FILE_BYTES = 20 * 1024 * 1024;

/**
 * The whole archive.
 *
 * A ZIP is assembled in memory (see `lib/finance/zip`), so this is the ceiling
 * that keeps a year's download from taking the serverless function's memory with
 * it. A month is nowhere near it; a whole financial year of scanned paper could
 * be, which is why the archive route counts as it goes and says what it left out
 * rather than dying halfway through.
 */
export const MAX_ARCHIVE_BYTES = 180 * 1024 * 1024;

export const EXTENSION_FOR: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "text/csv": "csv",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx"
};

export const isVaultFileType = (value: unknown): value is VaultFileType =>
  (VAULT_FILE_TYPES as readonly unknown[]).includes(value);

/**
 * What a browser sends for a spreadsheet, which is not always what it is.
 *
 * Windows reports `.csv` as `application/vnd.ms-excel` when Excel is installed,
 * and Chrome sometimes sends nothing at all for a file dragged in from a
 * network share. Rather than refuse a perfectly good invoice over a header, the
 * extension is allowed to settle it — the bytes are stored and served back with
 * whatever this decides, and nothing is executed either way.
 */
export function resolveFileType(reported: string, fileName: string): VaultFileType | null {
  if (isVaultFileType(reported)) return reported;

  const extension = fileName.toLowerCase().split(".").pop() ?? "";
  const match = Object.entries(EXTENSION_FOR).find(([, value]) => value === extension);
  return match && isVaultFileType(match[0]) ? match[0] : null;
}

/** "820 KB", "1.4 MB" — the size as somebody would say it out loud. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  return kb < 1024 ? `${Math.round(kb)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

/** The megabyte ceiling as a sentence, so both sides word the refusal the same. */
export const sizeLimitText = (limit: number) => `under ${Math.round(limit / (1024 * 1024))} MB`;

/** The accepted types as an `accept` attribute, so the file picker filters itself. */
export const ACCEPT_ATTRIBUTE = [...VAULT_FILE_TYPES, ".csv", ".xls", ".xlsx"].join(",");
