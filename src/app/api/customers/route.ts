import type { FilterQuery } from "mongoose";
import { connectDb } from "@/lib/db/mongoose";
import { Customer } from "@/models/Customer";
import { Counter } from "@/models/Settings";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok, pageParams } from "@/lib/api";
import { CUSTOMER_FIELDS, customerSchema } from "@/lib/billing/customers";
import { CUSTOMER_TYPES, stateCodeOfGstin, stateName } from "@/lib/billing/constants";

export async function GET(request: Request) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    // The buyer directory is a desk matter; field staff raise no bills.
    if (!can.viewAllBilling(auth.session.role)) return badRequest("You do not have access to this action", 403);

    await connectDb();
    const { page, limit, skip, q } = pageParams(request.url);
    const params = new URL(request.url).searchParams;
    const filter: FilterQuery<Record<string, unknown>> = {};

    // The picker only offers buyers still trading; the directory asks for all
    // so a dormant one can be brought back.
    if (params.get("all") !== "1") filter.active = true;
    const type = params.get("type");
    if (type && (CUSTOMER_TYPES as readonly string[]).includes(type)) filter.type = type;

    if (q) {
      const term = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
      filter.$or = [
        { name: term }, { businessName: term }, { code: term },
        { city: term }, { phones: term }, { gstin: term }, { contactPerson: term }
      ];
    }

    const [items, total] = await Promise.all([
      Customer.find(filter).select(CUSTOMER_FIELDS).sort({ name: 1 }).skip(skip).limit(limit).lean(),
      Customer.countDocuments(filter)
    ]);
    return ok({ items, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await apiSession(can.manageBilling);
    if ("response" in auth) return auth.response;
    await connectDb();

    const value = customerSchema.parse(await request.json());
    // Claimed from the counter rather than from a document count, so two
    // administrators adding a buyer at the same moment cannot share a code.
    const counter = await Counter.findOneAndUpdate(
      { key: "customer" }, { $inc: { value: 1 } }, { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean() as unknown as { value: number };

    // The state is readable off a GSTIN, so it can never contradict the number.
    const stateCode = value.stateCode || stateCodeOfGstin(value.gstin ?? "");
    const customer = await Customer.create({
      ...value,
      stateCode,
      state: stateName(stateCode),
      code: `BHX-C-${String(counter.value).padStart(5, "0")}`
    });
    return ok(customer, 201);
  } catch (error) {
    return fail(error);
  }
}
