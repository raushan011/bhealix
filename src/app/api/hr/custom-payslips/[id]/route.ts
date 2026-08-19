import { connectDb } from "@/lib/db/mongoose";
import { CustomPayslip } from "@/models/Payroll";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { record } from "@/lib/audit";
import { customPayslipSchema, customTotals } from "@/lib/hr/custom-payslip";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Params) {
  try {
    const auth = await apiSession(can.issueCustomPayslip);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Invalid payslip reference");

    await connectDb();
    const item = await CustomPayslip.findById(id).populate("createdBy", "name").lean();
    if (!item) return badRequest("That payslip could not be found", 404);
    return ok({ item });
  } catch (error) {
    return fail(error);
  }
}

/**
 * Rewrites the whole sheet. A custom payslip has no approval step to freeze
 * it — the administrator who wrote it is the one who may change it — so the
 * only record of what it used to say is the audit trail, which is why every
 * change leaves a line there.
 */
export async function PUT(request: Request, { params }: Params) {
  try {
    const auth = await apiSession(can.issueCustomPayslip);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Invalid payslip reference");

    const value = customPayslipSchema.parse(await request.json());
    await connectDb();

    const item = await CustomPayslip.findByIdAndUpdate(id,
      { $set: { ...value, ...customTotals(value), updatedBy: auth.session.userId } },
      { new: true, runValidators: true }).lean() as { _id: unknown; netPay: number } | null;
    if (!item) return badRequest("That payslip could not be found", 404);

    await record({
      actor: auth.session.userId, action: "payroll.custom.updated", entityType: "CustomPayslip",
      entityId: item._id,
      metadata: { title: value.title, period: value.periodLabel, status: value.status, netPay: item.netPay }
    });

    return ok({ item });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(_: Request, { params }: Params) {
  try {
    const auth = await apiSession(can.issueCustomPayslip);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Invalid payslip reference");

    await connectDb();
    const item = await CustomPayslip.findByIdAndDelete(id).lean() as
      { _id: unknown; title?: string; periodLabel?: string; netPay?: number } | null;
    if (!item) return badRequest("That payslip could not be found", 404);

    await record({
      actor: auth.session.userId, action: "payroll.custom.deleted", entityType: "CustomPayslip",
      entityId: item._id,
      metadata: { title: item.title, period: item.periodLabel, netPay: item.netPay }
    });

    return ok({ deleted: true });
  } catch (error) {
    return fail(error);
  }
}
