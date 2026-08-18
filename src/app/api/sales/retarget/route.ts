import { connectDb } from "@/lib/db/mongoose";
import { SalesShopOrder } from "@/models/Sales";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { fail, ok, pageParams } from "@/lib/api";
import { RETARGET_STATUSES, shopOrderFilter, shopOrderSort } from "@/lib/sales/retarget";

/**
 * Every Shopify order, filtered every way the calling desk asks.
 *
 * The filter is built once by `shopOrderFilter` and reused for the page, the
 * count and the status breakdown, so the three figures on the screen are three
 * views of one set. The facets — cities, products — are read over the whole
 * collection rather than the filtered set, because a dropdown that empties
 * itself as you narrow the list cannot be used to widen it again.
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

    const [items, total, byStatus, cities, products, months, due] = await Promise.all([
      SalesShopOrder.find(filter).sort(sort).skip(skip).limit(limit)
        .populate("rep", "name code")
        .lean(),
      SalesShopOrder.countDocuments(filter),
      SalesShopOrder.aggregate<{ _id: string; count: number }>([
        { $match: filter },
        { $group: { _id: "$retarget.status", count: { $sum: 1 } } }
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
      SalesShopOrder.countDocuments({ "retarget.nextFollowUpAt": { $lte: new Date() } })
    ]);

    const statuses = Object.fromEntries(RETARGET_STATUSES.map(status => [status, 0])) as Record<string, number>;
    for (const row of byStatus) if (row._id in statuses) statuses[row._id] = row.count;

    return ok({
      items,
      total,
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
