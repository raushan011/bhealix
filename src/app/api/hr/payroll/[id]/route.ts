import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { PayrollRun, Payslip } from "@/models/Payroll";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { record } from "@/lib/audit";
import { PAY_MODES } from "@/lib/hr/payroll";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), note: z.string().trim().max(300).optional() }),
  z.object({ action: z.literal("reopen"), note: z.string().trim().max(300).optional() }),
  z.object({
    action: z.literal("pay"),
    paymentDate: z.string().regex(ISO_DATE, "Give the payment date"),
    paymentMode: z.enum(PAY_MODES),
    reference: z.string().trim().max(80).optional()
  })
]);

/** One month's run with every payslip under it. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.viewPayroll);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Invalid payroll reference");

    await connectDb();
    const run = await PayrollRun.findById(id)
      .populate("generatedBy", "name").populate("approvedBy", "name").populate("paidBy", "name").lean();
    if (!run) return badRequest("That payroll month could not be found", 404);

    const payslips = await Payslip.find({ run: id })
      .populate("employee", "name employeeId role")
      .sort({ "snapshot.name": 1 }).lean();

    return ok({
      run, payslips,
      mayRun: can.runPayroll(auth.session.role),
      mayApprove: can.approvePayroll(auth.session.role)
    });
  } catch (error) {
    return fail(error);
  }
}

/**
 * Moves a run along: drafted, approved, paid.
 *
 * Approving is what freezes the figures, and it is the administrator's alone —
 * the desk that prepared the month does not also release it. Reopening is
 * allowed while nothing has been paid, and never afterwards: money that has
 * left the bank is corrected by a fresh entry, not by rewriting the month it
 * left in.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.approvePayroll);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Invalid payroll reference");

    await connectDb();
    const run = await PayrollRun.findById(id);
    if (!run) return badRequest("That payroll month could not be found", 404);

    const input = schema.parse(await request.json());
    const now = new Date();

    if (input.action === "approve") {
      if (run.status !== "Draft") return badRequest(`This month is already ${run.status.toLowerCase()}`);

      const count = await Payslip.countDocuments({ run: id });
      if (!count) return badRequest("There are no payslips in this month to approve");

      run.status = "Approved";
      run.approvedBy = auth.session.userId;
      run.approvedAt = now;
      if (input.note) run.note = input.note;
      await run.save();
      await Payslip.updateMany({ run: id }, { status: "Approved" });

      await record({
        actor: auth.session.userId, action: "payroll.approved", entityType: "PayrollRun", entityId: run._id,
        metadata: { month: run.month, employees: count, netPay: run.totals?.netPay }
      });
      return ok(run);
    }

    if (input.action === "reopen") {
      if (run.status === "Draft") return badRequest("This month is already a draft");
      if (run.status === "Paid") {
        return badRequest("This month has been paid. A correction belongs in a later month, not in this one.");
      }

      run.status = "Draft";
      run.approvedBy = undefined;
      run.approvedAt = undefined;
      if (input.note) run.note = input.note;
      await run.save();
      await Payslip.updateMany({ run: id }, { status: "Draft" });

      await record({
        actor: auth.session.userId, action: "payroll.reopened", entityType: "PayrollRun", entityId: run._id,
        metadata: { month: run.month, note: input.note }
      });
      return ok(run);
    }

    // Paying.
    if (run.status !== "Approved") {
      return badRequest("A month has to be approved before it can be marked paid");
    }

    run.status = "Paid";
    run.paidBy = auth.session.userId;
    run.paidAt = now;
    run.paymentDate = input.paymentDate;
    run.paymentMode = input.paymentMode;
    run.reference = input.reference;
    await run.save();
    await Payslip.updateMany({ run: id }, { status: "Paid" });

    await record({
      actor: auth.session.userId, action: "payroll.paid", entityType: "PayrollRun", entityId: run._id,
      metadata: { month: run.month, netPay: run.totals?.netPay, mode: input.paymentMode, reference: input.reference }
    });
    return ok(run);
  } catch (error) {
    return fail(error);
  }
}

/** Deletes a month that was never approved, and its payslips with it. */
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.approvePayroll);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Invalid payroll reference");

    await connectDb();
    const run = await PayrollRun.findById(id).select("month status");
    if (!run) return badRequest("That payroll month could not be found", 404);
    if (run.status !== "Draft") {
      return badRequest(`${run.month} has been ${run.status.toLowerCase()} and is part of the record now`);
    }

    await Payslip.deleteMany({ run: id });
    await PayrollRun.findByIdAndDelete(id);

    await record({
      actor: auth.session.userId, action: "payroll.deleted", entityType: "PayrollRun", entityId: id,
      metadata: { month: run.month }
    });

    return ok({ deleted: true, month: run.month });
  } catch (error) {
    return fail(error);
  }
}
