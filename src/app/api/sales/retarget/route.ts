import { connectDb } from "@/lib/db/mongoose";
import { SalesShopOrder } from "@/models/Sales";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { fail, ok, pageParams } from "@/lib/api";
import { RETARGET_STATUSES, shopOrderFilter, shopOrderSort } from "@/lib/sales/retarget";

/**
 * Every Shopify order, filtered every way the calling desk asks.
 *
 * The filter is built once by `shopOrderFilter` and reused for the page and
 * the count, so the list and its total are two views of one set.
 *
 * The chip counts are different on purpose: each chip answers "what would I
 * see if I tapped this now", so its count keeps every other filter but leaves
 * out its own dimension. Counting the status chips *with* the status filter
 * would zero every sibling tab the moment one is selected. The facets —
 * cities, products — are read over the whole collection rather than the
 * filtered set, because a dropdown that empties itself as you narrow the list
 * cannot be used to widen it again.
 */
export async function GET(request: Request) {
  try {
    const auth = await apiSession(can.viewSales);
    if ("response" in auth) return auth.response;
    await connectDb();

    const { page, limit, skip } = pageParams(request.url);
    const params = new URL(request.url).searchParams;
    const filter = shopOrderFilter(params);
    const sort = shopOrderSort(params.get("sort"));

    // The same filters with a chip's own dimension taken back out.
    const without = (...keys: string[]) => {
      const rest = new URLSearchParams(params);
      for (const key of keys) rest.delete(key);
      return shopOrderFilter(rest);
    };
    const statusFilter = without("status");
    const followUpFilter = without("followUp");
    const allFilter = without("status", "followUp");

    const [items, total, all, byStatus, cities, products, months, due] = await Promise.all([
      SalesShopOrder.find(filter).sort(sort).skip(skip).limit(limit)
        .populate("rep", "name code")
        .lean(),
      SalesShopOrder.countDocuments(filter),
      SalesShopOrder.countDocuments(allFilter),
      SalesShopOrder.aggregate<{ _id: string; count: number }>([
        { $match: statusFilter },
        // A row synced before the status existed has none; on screen it reads
        // "Not called", so it is counted there too.
        { $group: { _id: { $ifNull: ["$retarget.status", "Not called"] }, count: { $sum: 1 } } }
      ]),
      SalesShopOrder.distinct("customer.city", { "customer.city": { $nin: ["", null] } }),
      SalesShopOrder.distinct("products"),
      // Which months have orders at all, newest first, so the month picker
      // offers only months that will show something.
      SalesShopOrder.aggregate<{ _id: string }>([
        { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$placedAt", timezone: "Asia/Kolkata" } } } },
        { $sort: { _id: -1 } },
        { $limit: 36 }
      ]),
      SalesShopOrder.countDocuments({ ...followUpFilter, "retarget.nextFollowUpAt": { $lte: new Date() } })
    ]);

    const statuses = Object.fromEntries(RETARGET_STATUSES.map(status => [status, 0])) as Record<string, number>;
    for (const row of byStatus) if (row._id in statuses) statuses[row._id] = row.count;

    return ok({
      items,
      total,
      all,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
      statuses,
      followUpsDue: due,
      facets: {
        cities: (cities as string[]).map(city => city.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b)),
        products: (products as string[]).filter(Boolean).sort((a, b) => a.localeCompare(b)),
        months: months.map(row => row._id).filter(Boolean)
      },
      mayEdit: can.retargetCustomers(auth.session.role)
    });
  } catch (error) {
    return fail(error);
  }
}
