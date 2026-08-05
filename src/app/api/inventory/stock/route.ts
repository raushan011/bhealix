import { connectDb } from "@/lib/db/mongoose";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok } from "@/lib/api";
import { stockLevels } from "@/lib/inventory/ledger";

export async function GET() {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    // The warehouse position is a desk matter; field staff see their own bag
    // under Samples instead.
    if (!can.viewAllStock(auth.session.role)) return badRequest("You do not have access to this action", 403);

    await connectDb();
    const rows = await stockLevels();

    return ok({
      rows,
      totals: {
        products: rows.length,
        inStock: rows.filter(row => row.balance > 0).length,
        low: rows.filter(row => row.alert === "low").length,
        out: rows.filter(row => row.alert === "out").length,
        units: rows.reduce((sum, row) => sum + row.balance, 0),
        value: Math.round(rows.reduce((sum, row) => sum + row.stockValue, 0) * 100) / 100
      }
    });
  } catch (error) {
    return fail(error);
  }
}
