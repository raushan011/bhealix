import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { Product } from "@/models/Catalog";
import { Visit } from "@/models/Visit";
import { SampleMovement } from "@/models/Sample";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";

const schema = z.object({
  name: z.string().min(2).optional(),
  category: z.string().optional(),
  sampleAvailable: z.boolean().optional(),
  active: z.boolean().optional()
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.manageDoctors);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Invalid product reference");

    await connectDb();
    const product = await Product.findByIdAndUpdate(id, schema.parse(await request.json()), { new: true, runValidators: true });
    return product ? ok(product) : badRequest("Product not found", 404);
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

    const [inVisits, inLedger] = await Promise.all([
      Visit.countDocuments({ $or: [{ "samples.product": product.name }, { productsDiscussed: product.name }] }),
      SampleMovement.countDocuments({ productName: product.name })
    ]);
    const used = inVisits + inLedger;

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
