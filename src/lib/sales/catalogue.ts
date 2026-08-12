import { SalesCoupon, SalesOrder, SalesRep } from "@/models/Sales";
import { normaliseCode } from "./coupons";
import { fetchDiscounts, isLive } from "./discounts";
import { loadCredentials, shopifyConfig } from "./settings";

/**
 * Every coupon code in one place: what Shopify has, what orders have carried,
 * and who — if anybody — is being paid for it.
 *
 * The join is done at read time on purpose. Ownership lives on
 * `SalesRep.coupons` and nowhere else, so a code cannot be assigned in one
 * place and unassigned in another; the catalogue is only a record of what
 * *exists*.
 */

export type CatalogueEntry = {
  code: string;
  title?: string;
  status: string;
  summary?: string;
  live: boolean;
  ignored: boolean;
  usageCount?: number;
  discoveredFrom: string;
  lastSeenAt?: string;
  /** The rep holding it, when somebody does. */
  rep?: { _id: string; name: string; code: string; active: boolean };
  /** Which commission rule it pays under, from the rep's own entry. */
  suffix?: string;
  /** Attributed orders and revenue. Only counts orders this CRM has, so an unclaimed code shows zero. */
  orders: number;
  revenue: number;
};

/**
 * Records the codes seen on a batch of orders.
 *
 * Called by the sync for **every** order, attributed or not — an unattributed
 * order is precisely the one whose code nobody has claimed, and it is the
 * reason to look at this screen at all. Upserted rather than counted, because
 * re-syncing the same order would otherwise inflate a usage figure.
 */
export async function noteCodesSeen(codes: string[]): Promise<void> {
  const seen = [...new Set(codes.map(normaliseCode).filter(Boolean))];
  if (!seen.length) return;

  const now = new Date();
  await SalesCoupon.bulkWrite(seen.map(code => ({
    updateOne: {
      filter: { code },
      update: {
        $set: { lastSeenAt: now },
        $setOnInsert: { code, discoveredFrom: "Order", status: "Unknown", firstSeenAt: now }
      },
      upsert: true
    }
  })));
}

/**
 * Refreshes the catalogue from Shopify's own discount list.
 *
 * Needs `read_discounts`. Returns how many it found, or throws — the caller
 * reports the failure rather than showing an empty list as though the shop had
 * no coupons.
 */
export async function refreshFromShopify(): Promise<number> {
  const settings = await loadCredentials();
  const config = shopifyConfig(settings);
  if (!config) throw new Error("Shopify is not connected.");

  const discounts = await fetchDiscounts(config);
  if (!discounts.length) return 0;

  const now = new Date();
  await SalesCoupon.bulkWrite(discounts.map(discount => ({
    updateOne: {
      filter: { code: discount.code },
      update: {
        $set: {
          title: discount.title,
          status: discount.status,
          summary: discount.summary,
          startsAt: discount.startsAt ? new Date(discount.startsAt) : undefined,
          endsAt: discount.endsAt ? new Date(discount.endsAt) : undefined,
          usageCount: discount.usageCount,
          discoveredFrom: "Shopify",
          lastSeenAt: now
        },
        $setOnInsert: { code: discount.code, firstSeenAt: now }
      },
      upsert: true
    }
  })));

  return discounts.length;
}

type RepDoc = { _id: unknown; name?: string; code?: string; active?: boolean; coupons?: { code?: string; suffix?: string }[] };

/** The whole catalogue, joined and counted. */
export async function loadCatalogue(): Promise<CatalogueEntry[]> {
  const [coupons, reps, usage] = await Promise.all([
    SalesCoupon.find({}).sort({ code: 1 }).lean() as Promise<Record<string, unknown>[]>,
    SalesRep.find({}).select("name code active coupons").lean() as Promise<RepDoc[]>,
    SalesOrder.aggregate<{ _id: string; orders: number; revenue: number }>([
      { $match: { couponCode: { $ne: null } } },
      { $group: { _id: "$couponCode", orders: { $sum: 1 }, revenue: { $sum: "$totals.paid" } } }
    ])
  ]);

  const owner = new Map<string, { rep: CatalogueEntry["rep"]; suffix?: string }>();
  for (const rep of reps) {
    for (const coupon of rep.coupons ?? []) {
      const code = normaliseCode(coupon.code ?? "");
      if (!code) continue;
      owner.set(code, {
        rep: { _id: String(rep._id), name: rep.name ?? "", code: rep.code ?? "", active: rep.active !== false },
        suffix: coupon.suffix
      });
    }
  }

  const stats = new Map(usage.map(row => [normaliseCode(row._id), row]));

  // A code a rep holds that Shopify has never mentioned still belongs on the
  // list — otherwise assigning one by hand makes it vanish from the screen it
  // was assigned on.
  const known = new Set(coupons.map(entry => normaliseCode(String(entry.code))));
  const orphans = [...owner.keys()].filter(code => !known.has(code));

  const rows: CatalogueEntry[] = [
    ...coupons.map(entry => build(entry, owner, stats)),
    ...orphans.map(code => build({ code, status: "Unknown", discoveredFrom: "Order" }, owner, stats))
  ];

  // Unclaimed and live first — those are the ones costing money right now.
  return rows.sort((a, b) => {
    const urgency = (row: CatalogueEntry) => (row.rep ? 2 : row.ignored ? 3 : row.live ? 0 : 1);
    return urgency(a) - urgency(b) || b.orders - a.orders || a.code.localeCompare(b.code);
  });
}

function build(
  entry: Record<string, unknown>,
  owner: Map<string, { rep: CatalogueEntry["rep"]; suffix?: string }>,
  stats: Map<string, { orders: number; revenue: number }>
): CatalogueEntry {
  const code = normaliseCode(String(entry.code ?? ""));
  const held = owner.get(code);
  const used = stats.get(code);
  const status = String(entry.status ?? "Unknown");

  return {
    code,
    title: entry.title as string | undefined,
    status,
    summary: entry.summary as string | undefined,
    live: isLive(status),
    ignored: Boolean(entry.ignored),
    usageCount: entry.usageCount as number | undefined,
    discoveredFrom: String(entry.discoveredFrom ?? "Order"),
    lastSeenAt: entry.lastSeenAt ? new Date(entry.lastSeenAt as Date).toISOString() : undefined,
    rep: held?.rep,
    suffix: held?.suffix,
    orders: used?.orders ?? 0,
    revenue: Math.round(used?.revenue ?? 0)
  };
}
