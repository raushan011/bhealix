import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { SalesOrder, SalesRep } from "@/models/Sales";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok } from "@/lib/api";
import { record } from "@/lib/audit";
import { recalculateCommission } from "@/lib/sales/commission";
import { normaliseCode, parseCoupon } from "@/lib/sales/coupons";
import { toTable } from "@/lib/sales/csv";
import { mapHeaders, missingFields, readImport, type ImportedOrder } from "@/lib/sales/import";
import { holdDaysOf, loadSettings, rulesOf } from "@/lib/sales/settings";

/**
 * Importing orders from a checkout export.
 *
 * The way in when the Shopify Admin API cannot see the orders — which is the
 * case when the coupons are applied in Shiprocket's own checkout and the order
 * never lands in Shopify in a form the Orders API returns.
 *
 * Two steps on purpose, like every other thing here that commits money.
 * `preview` writes nothing and shows exactly what would be created, which rows
 * were skipped and why, and which coupons belong to nobody. Only `commit`
 * writes.
 *
 * An imported order is upserted on its name, so re-importing a longer export
 * that overlaps the last one corrects those rows rather than doubling them.
 */

const schema = z.object({
  action: z.enum(["preview", "commit"]),
  /** The file's text. A few thousand rows of CSV is well inside a JSON body. */
  csv: z.string().min(1, "The file is empty").max(5_000_000, "That file is too large to import in one go")
});

export async function POST(request: Request) {
  try {
    const auth = await apiSession(can.manageSales);
    if ("response" in auth) return auth.response;
    await connectDb();

    const { action, csv } = schema.parse(await request.json());
    const table = toTable(csv);
    if (!table.headers.length) return badRequest("That file has no header row, so there is no way to tell which column is which.");

    const mapping = mapHeaders(table.headers);
    const missing = missingFields(mapping);
    if (missing.length) {
      return badRequest(`Could not find a column for: ${missing.join(", ")}. The export needs at least an order id, the discount/coupon name and the amount paid. Columns found: ${table.headers.join(", ")}.`);
    }

    const summary = readImport(table.rows, mapping);

    // Which coupons belong to somebody here. A code on an order that matches no
    // rep is the single most useful thing this screen can report: the money is
    // already out of the door and nobody is being credited for it.
    const reps = await SalesRep.find({}).select("code coupons name").lean() as
      { _id: unknown; name?: string; coupons?: { code?: string; suffix?: string }[] }[];

    const byCode = new Map<string, { repId: string; suffix: string; name: string }>();
    for (const rep of reps) {
      for (const coupon of rep.coupons ?? []) {
        const code = normaliseCode(coupon.code ?? "");
        if (code) byCode.set(code, { repId: String(rep._id), suffix: coupon.suffix ?? parseCoupon(code)?.suffix ?? "", name: rep.name ?? "" });
      }
    }

    const known = summary.orders.filter(order => byCode.has(order.couponCode));
    const unknown = [...new Set(summary.orders.filter(order => !byCode.has(order.couponCode)).map(order => order.couponCode))];

    if (action === "preview") {
      return ok({
        mapping,
        headers: table.headers,
        rows: summary.rows,
        usable: summary.usable,
        attributable: known.length,
        skipped: summary.skipped,
        unknownCoupons: unknown,
        sample: known.slice(0, 10).map(order => ({
          name: order.name,
          couponCode: order.couponCode,
          rep: byCode.get(order.couponCode)?.name,
          total: order.total,
          discount: order.discount,
          delivery: order.delivery,
          placedAt: order.placedAt
        }))
      });
    }

    const settings = await loadSettings();
    const rules = rulesOf(settings);
    const holdDays = holdDaysOf(settings);

    let created = 0, updated = 0;
    for (const order of known) {
      const match = byCode.get(order.couponCode)!;
      const existing = await SalesOrder.findOne({ name: order.name });
      const document = existing ?? new SalesOrder({ source: "Import", name: order.name });

      Object.assign(document, {
        source: existing?.source === "Shopify" ? "Shopify" : "Import",
        placedAt: order.placedAt,
        customer: order.customer,
        couponCode: order.couponCode,
        rep: match.repId,
        ruleSuffix: match.suffix,
        discountCodes: [order.couponCode],
        items: [itemFrom(order)],
        totals: { gross: order.total + order.discount, discount: order.discount, refunded: 0, paid: order.total },
        syncedAt: new Date()
      });

      // The export's own status wins over anything guessed before; a shipment
      // sync can still correct it later, and a manual override still beats both.
      document.shipment = { ...(document.shipment ?? {}), status: order.deliveryStatus, checkedAt: new Date() };
      document.delivery.reported = order.delivery;
      if (order.delivery === "Delivered" && !document.shipment.deliveredAt) document.shipment.deliveredAt = order.placedAt;

      recalculateCommission(document, rules, { holdDays });
      await document.save();
      if (existing) updated++; else created++;
    }

    await record({
      actor: auth.session.userId,
      action: "sales.synced",
      entityType: "SalesOrder",
      entityId: "import",
      metadata: { source: "csv", rows: summary.rows, created, updated, unknownCoupons: unknown }
    });

    return ok({ rows: summary.rows, usable: summary.usable, created, updated, unknownCoupons: unknown, skipped: summary.skipped });
  } catch (error) {
    return fail(error);
  }
}

/**
 * The order as a single line.
 *
 * An export gives an order *total*, not a priced basket, so the whole order
 * becomes the coupon's base. For the orders this is used on — one product, one
 * coupon — that is exactly right, and prices identically to the same order
 * pulled from Shopify.
 *
 * Where it is coarser than the Shopify path: a basket carrying the kit **and**
 * something else is paid on the lot, because the file does not say which line
 * the coupon applied to. `source: "Import"` is what records that an order was
 * priced this way, and Shopify remains the better source wherever it can see
 * the order — re-syncing one later replaces these figures with per-line ones.
 */
const itemFrom = (order: ImportedOrder) => ({
  title: order.itemTitle,
  quantity: 1,
  gross: order.total + order.discount,
  couponDiscount: order.discount,
  otherDiscount: 0,
  refunded: 0
});
