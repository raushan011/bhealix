import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { SampleMovement } from "@/models/Sample";
import { Product } from "@/models/Catalog";
import { User } from "@/models/User";
import { apiSession } from "@/lib/auth/guard";
import { can, usesFieldPanel, type Role } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { MANUAL_MOVEMENT_TYPES, MOVEMENT_TYPES, signedQuantity, type ManualMovementType } from "@/lib/samples/movements";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const lineSchema = z.object({
  product: z.string().min(1),
  quantity: z.number().int().refine(value => value !== 0, "Quantity cannot be zero"),
  batchNo: z.string().max(60).optional(),
  expiryAt: z.string().regex(ISO_DATE).optional()
});

const schema = z.object({
  // DISPENSE is missing on purpose: it is written from the visit log, never by hand.
  type: z.enum(MANUAL_MOVEMENT_TYPES),
  employee: z.string().regex(OBJECT_ID, "Choose a representative"),
  occurredAt: z.string().regex(ISO_DATE).optional(),
  notes: z.string().max(500).optional(),
  lines: z.array(lineSchema).min(1, "Add at least one product")
});

/**
 * An administrator may move anyone's stock. A rep may only record their own
 * return — that is the one movement they are closest to and it can only ever
 * reduce what they are holding, so it cannot be used to inflate a count.
 */
function allows(type: ManualMovementType, role: Role, isSelf: boolean) {
  if (can.issueSamples(role)) return true;
  return type === "RETURN" && usesFieldPanel(role) && isSelf;
}

export async function GET(request: Request) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    await connectDb();

    const params = new URL(request.url).searchParams;
    const employee = params.get("employee") ?? "";
    const filter: Record<string, unknown> = {};

    if (usesFieldPanel(auth.session.role)) {
      // Field staff read their own ledger and nobody else's.
      filter.employee = auth.session.userId;
    } else {
      if (!can.viewAllStock(auth.session.role)) return badRequest("You do not have access to this action", 403);
      if (OBJECT_ID.test(employee)) filter.employee = employee;
    }

    const type = params.get("type");
    if (type && (MOVEMENT_TYPES as readonly string[]).includes(type)) filter.type = type;
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
    const items = await SampleMovement.find(filter)
      .populate("employee", "name employeeId")
      .populate("doctor", "name")
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
    const auth = await apiSession();
    if ("response" in auth) return auth.response;

    const input = schema.parse(await request.json());
    if (!allows(input.type, auth.session.role, input.employee === auth.session.userId)) {
      return badRequest("You do not have access to this action", 403);
    }
    // An issue or a return states a plain amount; only an adjustment carries a direction.
    if (input.type !== "ADJUSTMENT" && input.lines.some(line => line.quantity < 0)) {
      return badRequest("Quantity must be a positive number. Use an adjustment to take stock away.");
    }

    await connectDb();

    const employee = await User.findById(input.employee).select("name role active").lean() as
      { name: string; role: Role; active: boolean } | null;
    if (!employee) return badRequest("Employee not found", 404);
    if (!usesFieldPanel(employee.role)) return badRequest("Samples are only tracked for field staff");
    if (!employee.active) return badRequest(`${employee.name} is deactivated`);

    // Keep the ledger to catalogue names, so stock lines up with what reps can pick.
    const names = [...new Set(input.lines.map(line => line.product))];
    const catalogue = await Product.find({ name: { $in: names } }).select("name").lean() as
      unknown as Array<{ _id: unknown; name: string }>;
    const idByName = new Map(catalogue.map(product => [product.name, product._id]));
    const unknown = names.filter(name => !idByName.has(name));
    if (unknown.length) return badRequest(`Not in the product catalogue: ${unknown.join(", ")}`);

    const occurredAt = input.occurredAt ? new Date(`${input.occurredAt}T12:00:00`) : new Date();
    const created = await SampleMovement.insertMany(input.lines.map(line => ({
      employee: input.employee,
      product: idByName.get(line.product),
      productName: line.product,
      type: input.type,
      quantity: signedQuantity(input.type, line.quantity),
      batchNo: input.type === "ISSUE" ? line.batchNo : undefined,
      expiryAt: input.type === "ISSUE" && line.expiryAt ? new Date(`${line.expiryAt}T00:00:00`) : undefined,
      actor: auth.session.userId,
      occurredAt,
      notes: input.notes
    })));

    return ok({ recorded: created.length, employee: employee.name }, 201);
  } catch (error) {
    return fail(error);
  }
}
