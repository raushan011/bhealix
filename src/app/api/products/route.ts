import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { Product } from "@/models/Catalog";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { fail, ok } from "@/lib/api";
import { balancesByProduct, setStockLevel } from "@/lib/inventory/ledger";

const schema = z.object({
  name: z.string().min(2),
  category: z.string().optional(),
  sampleAvailable: z.boolean().default(true),
  hsnCode: z.string().trim().max(20).optional(),
  unit: z.string().trim().max(20).optional(),
  price: z.number().min(0).optional(),
  mrp: z.number().min(0).optional(),
  gstRate: z.number().min(0).max(50).optional(),
  reorderLevel: z.number().int().min(0).optional(),
  /**
   * Units available. Not a column on the product — it is written to the stock
   * ledger, which is the one pool that billing and sample issues both draw on.
   */
  stock: z.number().int().min(0).max(1_000_000).optional()
});

/** Everything a billing line or a stock row needs to know about a product. */
const PRODUCT_FIELDS = "name category sampleAvailable active hsnCode unit price mrp gstRate reorderLevel";

export async function GET(request: Request) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    await connectDb();
    // Reps only ever see what is currently on offer; the admin catalogue
    // asks for everything so retired items can be restored.
    const showAll = new URL(request.url).searchParams.get("all") === "1";
    const items = await Product.find(showAll ? {} : { active: true })
      .select(PRODUCT_FIELDS).sort({ name: 1 }).lean() as unknown as Array<{ name: string; stock?: number }>;

    // Units available ride along for the desk, so the catalogue can show and
    // edit them without a second request. Field staff read their own bag under
    // Samples instead, and are not shown the company's position.
    if (can.viewAllStock(auth.session.role)) {
      const balances = await balancesByProduct(items.map(item => item.name));
      for (const item of items) item.stock = balances.get(item.name) ?? 0;
    }

    return ok({ items });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await apiSession(can.manageDoctors);
    if ("response" in auth) return auth.response;
    await connectDb();
    const { stock, ...value } = schema.parse(await request.json());
    const product = await Product.create(value);

    // Written after the product exists, so a rejected name never leaves a
    // stock row behind for a product nobody can see.
    if (stock !== undefined && stock > 0) {
      await setStockLevel({
        productId: product._id, productName: product.name, target: stock,
        actor: auth.session.userId, notes: "Opening stock entered with the product"
      });
    }

    return ok(product, 201);
  } catch (error) {
    return fail(error);
  }
}
