import type { SourceKey } from "./sources";

/**
 * What the vault sends to the browser.
 *
 * Named here, in a module that imports nothing from Mongoose, so the screens can
 * hold the shape without dragging a model definition into the client bundle —
 * the same arrangement `lib/sales/types` uses next door. The bytes are
 * conspicuously absent from every one of these: a file is fetched from its own
 * route when somebody asks for it, and never serialised into a page.
 */

export type VaultDocument = {
  id: string;
  period: string;
  source: SourceKey;
  number?: string;
  /** ISO. The date printed on the document, which need not fall inside `period`. */
  documentDate?: string;
  description?: string;
  amount?: number;
  taxAmount?: number;
  currency: string;
  fileName: string;
  contentType: string;
  bytes: number;
  origin: "pulled" | "uploaded";
  notes?: string;
  filedAt?: string;
  filedBy?: string;
};

/** One source's standing in one month — the line the checklist is built from. */
export type VaultSourceLine = {
  source: SourceKey;
  count: number;
  amount: number;
  taxAmount: number;
  bytes: number;
  /** Documents are filed but none carries a figure, so the total understates. */
  unpriced: boolean;
  lastFiledAt?: string;
};

export type VaultSummary = {
  period: string;
  lines: VaultSourceLine[];
  /** Sources that were expected and have nothing filed. The point of the screen. */
  missing: SourceKey[];
  documents: number;
  amount: number;
  taxAmount: number;
  bytes: number;
  handedOverAt?: string;
  handedOverBy?: string;
  note?: string;
};

/** What a pull did, in the words the screen reports it in. */
export type PullOutcome = {
  source: SourceKey;
  filed: number;
  /** Orders the vendor had no document for — booked but never shipped, usually. */
  skipped: number;
  message: string;
};
