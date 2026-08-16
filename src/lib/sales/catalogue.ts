import { SalesCoupon, SalesOrder, SalesRep } from "@/models/Sales";
import { normaliseCode } from "./coupons";
import { fetchDiscounts, isLive } from "./discounts";
import { couponSetupOf, setupIsStale, type CouponSetupState } from "./partners";
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
  /**
   * Whether the code exists in Shopify, for the codes a rep minted themselves.
   *
   * Read off the rep's own coupon entry rather than off this catalogue, for the
   * same reason ownership is: there is one record of what a coupon is, and this
   * screen joins to it. Absent — and so `Live` — for every code entered by hand,
   * which is correct: it was entered because Shopify already had it.
   */
  setup?: CouponSetupState;
  setupError?: string;
  /** Whether the rep asked for it or the company issued it. */
  issuedBy?: string;
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

/**
 * Brings a rep's coupon back in step with what the shop actually has.
 *
 * `setup` records what happened when *this application* tried to create a
 * discount. It is not a fact about Shopify, and the gap between the two is
 * routine: an administrator creates the code by hand in the shop — very often
 * the moment the partner asks, before the retry queue is ever looked at — and
 * nothing tells this side. The row then reads `Awaiting setup` over a code that
 * has been working for a fortnight.
 *
 * That is not merely untidy. The same field is what the partner's own portal
 * reads, and it tells them their code "will not work at the checkout" while
 * customers are busy using it. A stored state contradicted by the shop's own
 * discount list is simply out of date, so it is corrected rather than displayed.
 *
 * Deliberately one-way. A code Shopify lists as live proves the setup finished;
 * a code Shopify does not list proves nothing — it may be paused, scheduled,
 * past its end date, or on a page the catalogue has not refreshed — and marking
 * a working code as broken on that basis would be a worse error than the one
 * this fixes.
 *
 * Returns the codes it corrected, so the caller can leave a line on the trail
 * for a change nobody pressed a button for.
 */
export async function reconcileCouponSetup(): Promise<string[]> {
  const catalogue = await SalesCoupon.find({}).select("code status").lean() as { code?: string; status?: string }[];
  const live = new Set(
    catalogue
      .filter(entry => isLive(String(entry.status ?? "")))
      .map(entry => normaliseCode(String(entry.code ?? "")))
      .filter(Boolean)
  );
  if (!live.size) return [];

  const reps = await SalesRep.find({ "coupons.code": { $in: [...live] } })
    .select("coupons").lean() as RepDoc[];

  const fixed: string[] = [];
  const writes = [];

  for (const rep of reps) {
    for (const coupon of rep.coupons ?? []) {
      const code = normaliseCode(coupon.code ?? "");
      if (!code || !setupIsStale(coupon, live.has(code))) continue;

      fixed.push(code);
      writes.push({
        updateOne: {
          // Matched on the stored spelling rather than the normalised one: the
          // positional `$` needs the filter to have found the element, and a
          // code stored lower-case would not match its own upper-case form.
          filter: { _id: rep._id, "coupons.code": coupon.code },
          update: { $set: { "coupons.$.setup": "Live" }, $unset: { "coupons.$.setupError": "" } }
        }
      });
    }
  }

  if (writes.length) await SalesRep.bulkWrite(writes);
  return fixed;
}

type RepCouponDoc = { code?: string; suffix?: string; setup?: string; setupError?: string; issuedBy?: string };
type RepDoc = { _id: unknown; name?: string; code?: string; active?: boolean; coupons?: RepCouponDoc[] };

/** What the join carries across from a rep's own coupon entry onto a catalogue row. */
type Held = { rep: CatalogueEntry["rep"]; suffix?: string; setup: CouponSetupState; setupError?: string; issuedBy?: string };

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

  const owner = new Map<string, Held>();
  for (const rep of reps) {
    for (const coupon of rep.coupons ?? []) {
      const code = normaliseCode(coupon.code ?? "");
      if (!code) continue;
      owner.set(code, {
        rep: { _id: String(rep._id), name: rep.name ?? "", code: rep.code ?? "", active: rep.active !== false },
        suffix: coupon.suffix,
        setup: couponSetupOf(coupon),
        setupError: coupon.setupError,
        issuedBy: coupon.issuedBy
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

  /*
   * Two kinds of urgency, and the newer one goes first.
   *
   * A rep's own code that never made it into Shopify is worse than an unclaimed
   * live code: the unclaimed one at least works, and only the accounting is
   * wrong. A code sitting at `Awaiting setup` is one a rep has been told is
   * theirs and which fails the moment a customer types it — nobody finds out
   * until they complain.
   */
  return rows.sort((a, b) => {
    const urgency = (row: CatalogueEntry) =>
      row.setup && row.setup !== "Live" ? 0 : row.rep ? 3 : row.ignored ? 4 : row.live ? 1 : 2;
    return urgency(a) - urgency(b) || b.orders - a.orders || a.code.localeCompare(b.code);
  });
}

function build(
  entry: Record<string, unknown>,
  owner: Map<string, Held>,
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
    setup: held?.setup,
    setupError: held?.setupError,
    issuedBy: held?.issuedBy,
    orders: used?.orders ?? 0,
    revenue: Math.round(used?.revenue ?? 0)
  };
}
