import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { Product } from "@/models/Catalog";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { fail, ok } from "@/lib/api";

const schema = z.object({
  name: z.string().min(2),
  category: z.string().optional(),
  sampleAvailable: z.boolean().default(true)
});

export async function GET() {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    await connectDb();
    const items = await Product.find({ active: true }).select("name category sampleAvailable").sort({ name: 1 }).lean();
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
    const product = await Product.create(schema.parse(await request.json()));
    return ok(product, 201);
  } catch (error) {
    return fail(error);
  }
}
