import { Types } from "mongoose";
import { SalesOrder } from "@/models/Sales";
import { VendorInvoice } from "@/models/Finance";
import { IntegrationError } from "@/lib/sales/http";
import { loadCredentials, shiprocketToken } from "@/lib/sales/settings";
import { documentUrl, fetchDocument } from "@/lib/sales/shiprocket";
import { formatPeriod, periodRange } from "./period";
import type { PullOutcome } from "./types";

/**
 * The one source the vault can go and fetch for itself.
 *
 * Shiprocket's order tax invoices, and they are fetchable for a specific reason:
 * this application already books those parcels, so it already holds the
 * credentials, already knows each order's Shiprocket id, and already calls the
 * endpoint that renders their invoices — `POST /orders/print/invoice`, the same
 * one the picking desk prints from. Nothing here is a new integration; it is an
 * existing one pointed at the accountant instead of at a printer.
 *
 * The other six sources are uploads, and that is a statement about the vendors
 * rather than about this code. A Shiprocket wallet recharge receipt, a Razorpay
 * fee invoice, the Shopify subscription bill and a Meta ads receipt are each
 * published in that company's own dashboard and none of them is exposed on an
 * API this account can call. Writing a "sync" that quietly fetched nothing would
 * be worse than not having one: the month would read as complete. So the vault
 * says plainly which sources it collects and which it expects a person to file,
 * links straight to the page each is downloaded from, and refuses to call a
 * month finished while one is missing.
 */

/**
 * How many orders' invoices are merged into one request.
 *
 * Shiprocket renders them server-side and starts refusing beyond about thirty,
 * which is why the picking screen prints in batches of thirty. A busy month is
 * several hundred orders, so a month is fetched as a run of batches and filed as
 * a run of documents — one PDF per batch rather than one enormous one, which is
 * also easier for somebody to open.
 */
const BATCH = 30;

/** Guards against a month with thousands of orders taking the function's whole budget. */
const MAX_BATCHES = 20;

/**
 * A batch's stable identity, so pulling August twice leaves one set of documents
 * rather than two.
 *
 * Keyed on the orders in the batch rather than on a counter: an order booked
 * late shifts every later batch's contents, and a counter would then file a
 * second copy of everything after it. The first and last order in the batch,
 * with the count, changes only when the batch's contents genuinely change.
 */
const refFor = (period: string, ids: string[]) =>
  `shiprocket-order:${period}:${ids[0]}-${ids[ids.length - 1]}:${ids.length}`;

/**
 * Files a month of Shiprocket order invoices.
 *
 * Idempotent by design — the button is on a screen somebody will press twice —
 * and honest about what it could not do: orders that were never booked with
 * Shiprocket have no invoice to fetch, and the count of those is reported rather
 * than silently dropped, because "142 filed, 8 skipped" is what tells somebody
 * eight parcels never went out.
 */
export async function pullShiprocketOrderInvoices(period: string, actor: string): Promise<PullOutcome> {
  const orders = await SalesOrder.find({
    placedAt: periodRange(period),
    "shipment.shiprocketOrderId": { $exists: true, $ne: null }
  }).select("name shipment placedAt").sort({ placedAt: 1 }).lean() as {
    name?: string; shipment?: { shiprocketOrderId?: string };
  }[];

  const total = await SalesOrder.countDocuments({ placedAt: periodRange(period) });
  const bookedIds = orders.map(order => String(order.shipment?.shiprocketOrderId ?? "")).filter(Boolean);
  const skipped = total - bookedIds.length;

  if (!bookedIds.length) {
    return {
      source: "shiprocket-order",
      filed: 0,
      skipped,
      message: total
        ? `${formatPeriod(period)} has ${total} order${total === 1 ? "" : "s"}, none of them booked with Shiprocket — so there are no tax invoices to fetch.`
        : `No orders were placed in ${formatPeriod(period)}.`
    };
  }

  const settings = await loadCredentials();
  const token = await shiprocketToken(settings);
  if (!token) {
    throw new IntegrationError("Shiprocket", "Shiprocket is not connected. Add the API user under Sales settings, then pull again.");
  }

  const all: string[][] = [];
  for (let start = 0; start < bookedIds.length; start += BATCH) all.push(bookedIds.slice(start, start + BATCH));

  /*
   * Batches already filed are skipped rather than re-rendered.
   *
   * That is what makes the cap below survivable: a month of nine hundred orders
   * takes three presses instead of one, and each press picks up where the last
   * left off rather than spending its whole budget re-fetching what is already
   * in the vault. Somebody who wants a document *re-rendered* — an invoice
   * corrected on Shiprocket's side after it was filed — deletes it and pulls
   * again, which is a deliberate act rather than a side effect of pressing a
   * button twice.
   */
  const refs = all.map(ids => refFor(period, ids));
  const already = new Set(await VendorInvoice.distinct("externalRef", {
    source: "shiprocket-order", externalRef: { $in: refs }
  }) as string[]);

  const outstanding = all.map((ids, index) => ({ ids, index, ref: refs[index] })).filter(batch => !already.has(batch.ref));
  const batches = outstanding.slice(0, MAX_BATCHES);
  const remaining = outstanding.length - batches.length;

  const uploader = new Types.ObjectId(actor);
  let filed = 0;

  for (const batch of batches) {
    const bytes = await fetchDocument(await documentUrl(token, "invoice", batch.ids));
    const part = all.length > 1 ? ` (part ${batch.index + 1} of ${all.length})` : "";

    await VendorInvoice.findOneAndUpdate(
      { source: "shiprocket-order", externalRef: batch.ref },
      { $set: {
        period,
        source: "shiprocket-order",
        description: `Tax invoices for ${batch.ids.length} shipment${batch.ids.length === 1 ? "" : "s"}${part}`,
        data: Buffer.from(bytes),
        contentType: "application/pdf",
        bytes: bytes.byteLength,
        fileName: `shiprocket-order-invoices-${period}${part ? `-${batch.index + 1}` : ""}.pdf`,
        origin: "pulled",
        uploadedBy: uploader
      } },
      { upsert: true, setDefaultsOnInsert: true }
    );
    filed += batch.ids.length;
  }

  return {
    source: "shiprocket-order",
    filed,
    skipped,
    message: [
      filed
        ? `Filed the tax invoices for ${filed} shipment${filed === 1 ? "" : "s"} in ${formatPeriod(period)}, as ${batches.length} PDF${batches.length === 1 ? "" : "s"}.`
        : `${formatPeriod(period)} was already up to date — every booked shipment's tax invoice is in the vault.`,
      skipped ? `${skipped} order${skipped === 1 ? " was" : "s were"} never booked with Shiprocket, so ${skipped === 1 ? "it has" : "they have"} no invoice.` : "",
      // Said out loud rather than left to be discovered: a silently truncated
      // month is a month the accountant is short of paperwork on.
      remaining ? `${remaining * BATCH} more shipments are still to fetch — press Pull again to continue.` : ""
    ].filter(Boolean).join(" ")
  };
}
