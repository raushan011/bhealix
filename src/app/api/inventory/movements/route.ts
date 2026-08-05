import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { StockMovement } from "@/models/Inventory";
import { Product } from "@/models/Catalog";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok } from "@/lib/api";
import { fromDateInput } from "@/lib/time";
import { MANUAL_STOCK_TYPES, signedStock, STOCK_MOVEMENT_TYPES } from "@/lib/inventory/movements";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const lineSchema = z.object({
  product: z.string().trim().min(1),
  quantity: z.number().int().refine(value => value !== 0, "Quantity cannot be zero"),
  unitCost: z.number().min(0).optional(),
  batchNo: z.string().trim().max(60).optional(),
  expiryAt: z.string().regex(ISO_DATE).optional()
});

const schema = z.object({
  // SALE and the two SAMPLE_ types are missing on purpose: they are written by
  // the invoice and by the sample ledger, never typed in.
  type: z.enum(MANUAL_STOCK_TYPES),
  occurredAt: z.string().regex(ISO_DATE).optional(),
  supplier: z.string().trim().max(200).optional(),
  reference: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(500).optional(),
  lines: z.array(lineSchema).min(1, "Add at least one product")
});

export async function GET(request: Request) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    if (!can.viewAllStock(auth.session.role)) return badRequest("You do not have access to this action", 403);

    await connectDb();
    const params = new URL(request.url).searchParams;
    const filter: Record<string, unknown> = {};

    const type = params.get("type");
    if (type && (STOCK_MOVEMENT_TYPES as readonly string[]).includes(type)) filter.type = type;
    const product = params.get("product");
    if (product) filter.productName = product;

    const from = params.get("from"), to = params.get("to");
    if ((from && ISO_DATE.test(from)) || (to && ISO_DATE.test(to))) {
      filter.occurredAt = {
        ...(from && ISO_DATE.test(from) ? { $gte: new Date(`${from}T00:00:00`) } : {}),
        ...(to && ISO_DATE.test(to) ? { $lte: new Date(`${to}T23:59:59`) } : {})
      };
    }

    const limit = Math.min(500, Math.max(1, Number(params.get("limit")) || 100));
    const items = await StockMovement.find(filter)
      .populate("invoice", "invoiceNo")
      .populate("employee", "name employeeId")
      .populate("actor", "name")
      .sort({ occurredAt: -1, createdAt: -1 })
      .limit(limit)
      .lean();

    return ok({ items });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await apiSession(can.manageInventory);
    if ("response" in auth) return auth.response;

    const input = schema.parse(await request.json());
    // Stock coming in states a plain amount; only an adjustment carries a direction.
    if (input.type !== "ADJUSTMENT" && input.lines.some(line => line.quantity < 0)) {
      return badRequest("Quantity must be a positive number. Use an adjustment to take stock away.");
    }

    await connectDb();

    // Keep the ledger to catalogue names, so stock lines up with what can be billed.
    const names = [...new Set(input.lines.map(line => line.product))];
    const catalogue = await Product.find({ name: { $in: names } }).select("name").lean() as
      unknown as Array<{ _id: unknown; name: string }>;
    const idByName = new Map(catalogue.map(product => [product.name, product._id]));
    const unknown = names.filter(name => !idByName.has(name));
    if (unknown.length) return badRequest(`Not in the product catalogue: ${unknown.join(", ")}`);

    const occurredAt = input.occurredAt ? fromDateInput(input.occurredAt) : new Date();
    const created = await StockMovement.insertMany(input.lines.map(line => ({
      product: idByName.get(line.product),
      productName: line.product,
      type: input.type,
      quantity: signedStock(input.type, line.quantity),
      unitCost: line.unitCost,
      batchNo: input.type === "ADJUSTMENT" ? undefined : line.batchNo,
      expiryAt: input.type === "ADJUSTMENT" || !line.expiryAt ? undefined : new Date(`${line.expiryAt}T00:00:00`),
      supplier: input.supplier,
      reference: input.reference,
      actor: auth.session.userId,
      occurredAt,
      notes: input.notes
    })));

    return ok({ recorded: created.length }, 201);
  } catch (error) {
    return fail(error);
  }
}
