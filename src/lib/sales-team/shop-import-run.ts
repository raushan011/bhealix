import { SalesTeamOrder, SalesTeamSettings } from "@/models/SalesTeam";
import { User } from "@/models/User";
import { loadCredentials, shiprocketToken, shopifyConfig } from "@/lib/sales/settings";
import { scanOrders } from "@/lib/sales/shiprocket";
import { fetchOrders, mapOrder, mergeCustomer, type ShopifyOrder } from "@/lib/sales/shopify";
import { shiftDay, todayIso } from "@/lib/time";
import { executiveTag } from "./shopify-order";
import {
  copyOfCrmOrder, executiveFromTags, IMPORT_FROM, shiprocketDate, shiprocketKeysOf, teamOrderFromShiprocket, teamOrderFromShopify,
  type CrmOrderRef
} from "./shop-import";

/**
 * Bringing shop and courier orders into the Sales CRM — the reading and the
 * writing around the pure rules in `shop-import.ts`.
 */

export type ShopifyImportReport = { read: number; added: number; updated: number; linked: number };
export type ImportReport = { from: string; shopify?: ShopifyImportReport; shiprocket?: { read: number; added: number }; errors: string[] };

const IMPORTED = ["Shopify", "Shiprocket"];
const isoOf = (date: Date) => date.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

type Executive = { _id: unknown; name: string };

async function executivesByTag(): Promise<Map<string, Executive>> {
  const people = await User.find({ role: "EXECUTIVE", employeeId: { $nin: [null, ""] } }).select("name employeeId").lean() as unknown as Array<Executive & { employeeId: string }>;
  return new Map(people.map(person => [executiveTag(person.employeeId).toLowerCase(), { _id: person._id, name: person.name }]));
}

/**
 * Writes a batch of Shopify orders into the CRM: new ones added, imported ones
 * kept current (cancellation, payment, address, a tag naming an executive),
 * copies of CRM orders linked to their original, and orders this CRM placed
 * itself left alone — the team's own sync keeps those.
 */
export async function importShopifyBatch(raws: ShopifyOrder[]): Promise<ShopifyImportReport> {
  const report: ShopifyImportReport = { read: raws.length, added: 0, updated: 0, linked: 0 };
  const wanted = raws.filter(raw => raw.created_at && new Date(raw.created_at) >= IMPORT_FROM);
  if (!wanted.length) return report;

  const ids = wanted.map(raw => String(raw.id));
  const [existing, crm, byTag] = await Promise.all([
    SalesTeamOrder.find({ shopifyOrderId: { $in: ids } }).select("shopifyOrderId origin executive customer cancelledAt").lean() as unknown as Promise<Array<{
      _id: unknown; shopifyOrderId: string; origin?: string; executive?: unknown; customer?: Record<string, string | undefined>; cancelledAt?: Date;
    }>>,
    SalesTeamOrder.find({ origin: { $nin: IMPORTED }, placedAt: { $gte: new Date(IMPORT_FROM.getTime() - 15 * 86_400_000) } })
      .select("ref shopifyOrderId placedAt totals.paid customer.phone shipment.awb shipment.channelOrderId").lean() as unknown as Promise<Array<CrmOrderRef & { shipment?: { awb?: string; channelOrderId?: string } }>>,
    executivesByTag()
  ]);
  const known = new Map(existing.map(row => [row.shopifyOrderId, row]));

  for (const raw of wanted) {
    const mapped = mapOrder(raw);
    const before = known.get(mapped.shopifyOrderId);
    if (before && !IMPORTED.includes(String(before.origin ?? "CRM"))) continue;

    if (before) {
      const executive = before.executive ? undefined : executiveFromTags(raw, byTag);
      const lost = mapped.cancelledAt || mapped.fullyRefunded;
      await SalesTeamOrder.updateOne({ _id: before._id }, {
        $set: {
          financialStatus: mapped.financialStatus,
          customer: mergeCustomer(before.customer, mapped.customer),
          ...(executive ? { executive: executive._id, executiveName: executive.name } : {}),
          ...(lost && !before.cancelledAt ? {
            cancelledAt: mapped.cancelledAt ?? new Date(), cancelReason: mapped.cancelledAt ? "Cancelled in Shopify." : "Refunded in full in Shopify.",
            "delivery.state": "Cancelled"
          } : {})
        }
      });
      report.updated++;
      continue;
    }

    const original = copyOfCrmOrder(raw, mapped, crm);
    if (original) {
      // The copy is the original's parcel: Shiprocket is asked about it under the copy's number from now on.
      if (!original.shipment?.awb && !original.shipment?.channelOrderId) {
        await SalesTeamOrder.updateOne({ _id: original._id }, { $set: { "shipment.channelOrderId": mapped.name.replace(/^#/, "") } });
      }
      report.linked++;
      continue;
    }

    try {
      await SalesTeamOrder.create(teamOrderFromShopify(raw, mapped, executiveFromTags(raw, byTag)));
      report.added++;
    } catch (error) {
      // Another pass (the webhook, say) added it a moment ago.
      if ((error as { code?: number }).code !== 11000) throw error;
    }
  }
  return report;
}

/**
 * Orders that exist only on the courier account — Shiprocket's custom channel,
 * typed in there by hand — added from `from` on. Anything already here under
 * its order id, airway bill or Shiprocket id is skipped, which is every shop
 * order once the Shopify half has run.
 */
export async function importShiprocketOrders(token: string, from: string): Promise<{ read: number; added: number }> {
  const rows = (await scanOrders(token, from, todayIso())).filter(row => (shiprocketDate(row.createdAt) ?? new Date(0)) >= IMPORT_FROM);
  const report = { read: rows.length, added: 0 };
  if (!rows.length) return report;

  const here = await SalesTeamOrder.find({ placedAt: { $gte: new Date(IMPORT_FROM.getTime() - 30 * 86_400_000) } })
    .select("name ref shipment.awb shipment.shiprocketOrderId shipment.channelOrderId").lean() as unknown as Array<{
      name: string; ref?: string; shipment?: { awb?: string; shiprocketOrderId?: string; channelOrderId?: string };
    }>;
  const keys = new Set<string>();
  for (const order of here) {
    for (const value of [order.name, order.ref, order.shipment?.channelOrderId]) {
      const key = String(value ?? "").trim().toUpperCase();
      if (key) { keys.add(key); keys.add(key.replace(/^#/, "")); }
    }
    if (order.shipment?.awb) keys.add(`AWB:${order.shipment.awb}`);
    if (order.shipment?.shiprocketOrderId) keys.add(`SR:${order.shipment.shiprocketOrderId}`);
  }

  for (const row of rows) {
    if (shiprocketKeysOf(row).some(key => keys.has(key)) || (row.awb && keys.has(`AWB:${row.awb}`)) || keys.has(`SR:${row.shiprocketOrderId}`)) continue;
    try {
      await SalesTeamOrder.create(teamOrderFromShiprocket(row));
      shiprocketKeysOf(row).forEach(key => keys.add(key));
      report.added++;
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
    }
  }
  return report;
}

/**
 * One import pass: Shopify, then Shiprocket. The first pass reaches back to
 * `IMPORT_FROM`; later ones only to just before the last (an hour's overlap for
 * Shopify, two days for Shiprocket's day-based list), so a pass is quick and
 * nothing falls in a gap. `full` reaches back to the start again.
 */
export async function importShopOrders({ full = false } = {}): Promise<ImportReport> {
  const started = new Date();
  const settings = await SalesTeamSettings.findOne({ key: "sales-team" }).select("lastShopImportAt").lean() as { lastShopImportAt?: Date } | null;
  const last = !full && settings?.lastShopImportAt ? settings.lastShopImportAt : null;
  const since = last && last > IMPORT_FROM ? new Date(last.getTime() - 3_600_000) : IMPORT_FROM;
  const report: ImportReport = { from: isoOf(since), errors: [] };
  const credentials = await loadCredentials();

  const config = shopifyConfig(credentials);
  if (config) {
    try {
      report.shopify = await importShopifyBatch(await fetchOrders(config, since));
    } catch (error) {
      report.errors.push(`Shopify: ${error instanceof Error ? error.message : "did not answer"}`);
    }
  }

  try {
    const token = await shiprocketToken(credentials);
    if (token) {
      const from = shiftDay(isoOf(since), -2);
      report.shiprocket = await importShiprocketOrders(token, from < isoOf(IMPORT_FROM) ? isoOf(IMPORT_FROM) : from);
    }
  } catch (error) {
    report.errors.push(`Shiprocket: ${error instanceof Error ? error.message : "did not answer"}`);
  }

  await SalesTeamSettings.updateOne({ key: "sales-team" }, report.errors.length
    ? { $set: { lastShopImportError: report.errors.join(" ") } }
    : { $set: { lastShopImportAt: started }, $unset: { lastShopImportError: "" } }, { upsert: true });
  return report;
}
