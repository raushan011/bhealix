import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { Product } from "@/models/Catalog";
import { Visit } from "@/models/Visit";
import { SampleMovement } from "@/models/Sample";
import { StockMovement } from "@/models/Inventory";
import { Invoice } from "@/models/Invoice";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { renameProductInLedgers, setStockLevel } from "@/lib/inventory/ledger";

const schema = z.object({
  name: z.string().min(2).optional(),
  category: z.string().optional(),
  sampleAvailable: z.boolean().optional(),
  active: z.boolean().optional(),
  hsnCode: z.string().trim().max(20).optional(),
  unit: z.string().trim().max(20).optional(),
  price: z.number().min(0).optional(),
  mrp: z.number().min(0).optional(),
  gstRate: z.number().min(0).max(50).optional(),
  reorderLevel: z.number().int().min(0).optional(),
  /** Units available — written to the stock ledger, not onto the product. */
  stock: z.number().int().min(0).max(1_000_000).optional()
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.manageDoctors);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Invalid product reference");

    await connectDb();
    const existing = await Product.findById(id).select("name").lean() as { name: string } | null;
    if (!existing) return badRequest("Product not found", 404);

    const { stock, ...value } = schema.parse(await request.json());
    const product = await Product.findByIdAndUpdate(id, value, { new: true, runValidators: true });
    if (!product) return badRequest("Product not found", 404);

    // Both stock ledgers are keyed by name, so a rename has to take them with
    // it or the units would be stranded under a name nothing points at.
    if (value.name && value.name !== existing.name) {
      await renameProductInLedgers(existing.name, product.name);
    }

    if (stock !== undefined) {
      await setStockLevel({
        productId: product._id, productName: product.name, target: stock,
        actor: auth.session.userId, notes: "Counted from the product catalogue"
      });
    }

    return ok(product);
  } catch (error) {
    return fail(error);
  }
}

/**
 * Visits and the sample ledger record the product name as text, so past records
 * survive a deletion. A product still in use is retired instead, keeping reports
 * and stock balances honest while removing it from the rep's picker.
 */
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.manageDoctors);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Invalid product reference");

    await connectDb();
    const product = await Product.findById(id);
    if (!product) return badRequest("Product not found", 404);

    const [inVisits, inLedger, inStock, inInvoices] = await Promise.all([
      Visit.countDocuments({ $or: [{ "samples.product": product.name }, { productsDiscussed: product.name }] }),
      SampleMovement.countDocuments({ productName: product.name }),
      StockMovement.countDocuments({ productName: product.name }),
      Invoice.countDocuments({ "items.name": product.name })
    ]);
    const used = inVisits + inLedger + inStock + inInvoices;

    if (used) {
      product.active = false;
      await product.save();
      return ok({ retired: true, usedIn: used, name: product.name });
    }

    await Product.findByIdAndDelete(id);
    return ok({ deleted: true, name: product.name });
  } catch (error) {
    return fail(error);
  }
}
