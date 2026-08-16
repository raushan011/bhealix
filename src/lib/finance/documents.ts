import { FinancePeriod, VendorInvoice } from "@/models/Finance";
import { isPeriod } from "./period";
import { EXPECTED_SOURCES, isSourceKey, SOURCES, type SourceKey } from "./sources";
import type { VaultDocument, VaultSourceLine, VaultSummary } from "./types";

/**
 * Reading the vault.
 *
 * Two shapes come out of here and they answer different questions. The **list**
 * is "what is filed for August", which is what the table shows. The **summary**
 * is "what is *missing* from August", which is the question the whole feature
 * exists for — a bundle that is short one Meta receipt looks exactly like a
 * complete one until the return is being filed, and nobody notices by scrolling.
 */

/** Never the bytes. Every list on every screen is served from this projection. */
const LIST_FIELDS = "period source number documentDate description amount taxAmount currency fileName contentType bytes origin externalRef notes createdAt updatedAt uploadedBy";

type Row = {
  _id: unknown;
  period: string;
  source: string;
  number?: string;
  documentDate?: Date;
  description?: string;
  amount?: number;
  taxAmount?: number;
  currency?: string;
  fileName: string;
  contentType: string;
  bytes: number;
  origin: string;
  externalRef?: string;
  notes?: string;
  createdAt?: Date;
  uploadedBy?: { name?: string } | unknown;
};

const nameOf = (value: unknown): string | undefined =>
  value && typeof value === "object" && "name" in value ? String((value as { name?: string }).name ?? "") || undefined : undefined;

export const toVaultDocument = (row: Row): VaultDocument => ({
  id: String(row._id),
  period: row.period,
  source: row.source as SourceKey,
  number: row.number,
  documentDate: row.documentDate?.toISOString(),
  description: row.description,
  amount: row.amount,
  taxAmount: row.taxAmount,
  currency: row.currency ?? "INR",
  fileName: row.fileName,
  contentType: row.contentType,
  bytes: row.bytes,
  origin: row.origin === "pulled" ? "pulled" : "uploaded",
  notes: row.notes,
  filedAt: row.createdAt?.toISOString(),
  filedBy: nameOf(row.uploadedBy)
});

/** The filter a list, a count and an archive all have to agree on. */
export function vaultQuery({ period, source, vendor }: { period?: string | null; source?: string | null; vendor?: string | null }) {
  const query: Record<string, unknown> = {};
  if (isPeriod(period)) query.period = period;

  if (isSourceKey(source)) {
    query.source = source;
  } else if (vendor) {
    // A vendor is several sources — Shiprocket alone is three — so filtering by
    // one has to expand to the set rather than compare a field that is not there.
    const keys = SOURCES.filter(entry => entry.vendor.toLowerCase() === vendor.toLowerCase()).map(entry => entry.key);
    if (keys.length) query.source = { $in: keys };
  }

  return query;
}

/** What is filed, newest document first. */
export async function listDocuments(filter: Parameters<typeof vaultQuery>[0]): Promise<VaultDocument[]> {
  const rows = await VendorInvoice.find(vaultQuery(filter))
    .select(LIST_FIELDS)
    .populate("uploadedBy", "name")
    .sort({ period: -1, documentDate: -1, createdAt: -1 })
    .lean() as unknown as Row[];

  return rows.map(toVaultDocument);
}

/**
 * The month at a glance: every source that ought to have something, whether it
 * does, and what it comes to.
 *
 * Built from one aggregation rather than one query per source. There are seven
 * sources and a round trip each would be seven round trips for a screen that
 * loads on every visit — and the aggregation is the same shape whether the month
 * holds three documents or three hundred.
 *
 * Sources with nothing filed are *not* dropped. A row reading "nothing filed" is
 * the entire value of this summary; a list of only what exists is the list on the
 * screen below it.
 */
export async function summarise(period: string): Promise<VaultSummary> {
  const grouped = await VendorInvoice.aggregate([
    { $match: { period } },
    { $group: {
      _id: "$source",
      count: { $sum: 1 },
      amount: { $sum: { $ifNull: ["$amount", 0] } },
      tax: { $sum: { $ifNull: ["$taxAmount", 0] } },
      bytes: { $sum: "$bytes" },
      /** Whether any figure was recorded at all, which is different from zero. */
      priced: { $sum: { $cond: [{ $gt: ["$amount", 0] }, 1, 0] } },
      lastFiledAt: { $max: "$createdAt" }
    } }
  ]);

  const byKey = new Map(grouped.map((entry: { _id: string }) => [entry._id, entry]));

  const lines: VaultSourceLine[] = SOURCES.map(source => {
    const found = byKey.get(source.key) as
      { count: number; amount: number; tax: number; bytes: number; priced: number; lastFiledAt?: Date } | undefined;
    return {
      source: source.key,
      count: found?.count ?? 0,
      amount: found?.amount ?? 0,
      taxAmount: found?.tax ?? 0,
      bytes: found?.bytes ?? 0,
      /**
       * Set when documents are filed but none carries a figure — the archive is
       * complete and the total on screen is a lie of omission, which is worth
       * saying out loud rather than showing ₹0 beside four invoices.
       */
      unpriced: Boolean(found?.count) && !found?.priced,
      lastFiledAt: found?.lastFiledAt?.toISOString()
    };
  });

  const filed = new Set(lines.filter(line => line.count > 0).map(line => line.source));
  const missing = EXPECTED_SOURCES.filter(source => !filed.has(source.key)).map(source => source.key);

  const state = await FinancePeriod.findOne({ period })
    .populate("handedOverBy", "name")
    .lean() as { handedOverAt?: Date; handedOverBy?: unknown; note?: string } | null;

  return {
    period,
    lines,
    missing,
    documents: lines.reduce((total, line) => total + line.count, 0),
    amount: lines.reduce((total, line) => total + line.amount, 0),
    taxAmount: lines.reduce((total, line) => total + line.taxAmount, 0),
    bytes: lines.reduce((total, line) => total + line.bytes, 0),
    handedOverAt: state?.handedOverAt?.toISOString(),
    handedOverBy: nameOf(state?.handedOverBy),
    note: state?.note
  };
}

/**
 * Every month that has anything in it, newest first, with this one included
 * whether it does or not.
 *
 * The current month is forced in because it is the one being worked on, and a
 * picker that only offers months already filed would have nowhere to file the
 * first document of August into.
 */
export async function periodsWithDocuments(current: string): Promise<string[]> {
  const found = await VendorInvoice.distinct("period") as string[];
  return [...new Set([current, ...found])].filter(isPeriod).sort().reverse();
}
