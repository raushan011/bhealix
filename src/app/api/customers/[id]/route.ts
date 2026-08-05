import { connectDb } from "@/lib/db/mongoose";
import { Customer } from "@/models/Customer";
import { Invoice } from "@/models/Invoice";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { CUSTOMER_FIELDS, customerSchema } from "@/lib/billing/customers";
import { stateCodeOfGstin, stateName } from "@/lib/billing/constants";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    if (!can.viewAllBilling(auth.session.role)) return badRequest("You do not have access to this action", 403);

    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Invalid customer reference");

    await connectDb();
    const [customer, invoices] = await Promise.all([
      Customer.findById(id).select(CUSTOMER_FIELDS).lean(),
      Invoice.find({ customer: id }).select("invoiceNo invoiceDate grandTotal balanceDue status dueDate taxed")
        .sort({ invoiceDate: -1 }).limit(20).lean()
    ]);
    return customer ? ok({ customer, invoices }) : badRequest("Customer not found", 404);
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.manageBilling);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Invalid customer reference");

    await connectDb();
    const value = customerSchema.partial().parse(await request.json());
    const update: Record<string, unknown> = { ...value };

    // Keep the state in step with whichever of the two was edited.
    if (value.stateCode !== undefined || value.gstin !== undefined) {
      const stateCode = value.stateCode || stateCodeOfGstin(value.gstin ?? "");
      if (stateCode) { update.stateCode = stateCode; update.state = stateName(stateCode); }
    }

    const customer = await Customer.findByIdAndUpdate(id, update, { new: true, runValidators: true }).select(CUSTOMER_FIELDS);
    return customer ? ok(customer) : badRequest("Customer not found", 404);
  } catch (error) {
    return fail(error);
  }
}

/**
 * A buyer who has been billed is deactivated rather than deleted, so the
 * invoices raised against them keep pointing at a real record.
 */
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.manageBilling);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Invalid customer reference");

    await connectDb();
    const customer = await Customer.findById(id).select("name").lean() as { name: string } | null;
    if (!customer) return badRequest("Customer not found", 404);

    const billed = await Invoice.countDocuments({ customer: id });
    if (billed) {
      await Customer.findByIdAndUpdate(id, { active: false });
      return ok({ deactivated: true, billed, name: customer.name });
    }

    await Customer.findByIdAndDelete(id);
    return ok({ deleted: true, name: customer.name });
  } catch (error) {
    return fail(error);
  }
}
