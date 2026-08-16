import { Types } from "mongoose";
import { VendorInvoice } from "@/models/Finance";
import { resolveFileType } from "./files";
import type { FetchedDocument } from "./connectors/types";
import type { SourceKey } from "./sources";

/**
 * Puts what a connector fetched into the vault.
 *
 * Upserted on `externalRef` rather than inserted, so pressing Fetch twice leaves
 * one document rather than two — and a month re-fetched after a late transaction
 * lands replaces the statement instead of sitting beside a stale one. That
 * reference is the connector's to make stable; every one of them keys it on the
 * vendor and the period.
 *
 * Kept apart from the connectors themselves because none of them should know
 * what a `VendorInvoice` is: a connector's job ends at "here are the bytes and
 * what they are", which is also what makes it testable without a database.
 */
export async function fileFetched(source: SourceKey, period: string, documents: readonly FetchedDocument[], actor: string) {
  const uploader = new Types.ObjectId(actor);

  for (const document of documents) {
    // The connectors set this themselves, but the schema enum is the thing that
    // would reject the write — so it is resolved the same way an upload is.
    const contentType = resolveFileType(document.contentType, document.fileName);
    if (!contentType) throw new Error(`${source} produced a ${document.contentType}, which the vault will not store.`);

    await VendorInvoice.findOneAndUpdate(
      { source, externalRef: document.externalRef },
      { $set: {
        period,
        source,
        number: document.number,
        documentDate: document.documentDate,
        description: document.description,
        amount: document.amount,
        taxAmount: document.taxAmount,
        data: document.data,
        contentType,
        bytes: document.data.length,
        fileName: document.fileName,
        origin: "pulled",
        uploadedBy: uploader
      } },
      { upsert: true, setDefaultsOnInsert: true }
    );
  }

  return documents.length;
}
