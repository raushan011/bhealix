import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { SalesPayout, SalesPayoutLine } from "@/models/Sales";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { record } from "@/lib/audit";
import { PAYOUT_MODES } from "@/lib/sales/constants";
import {
  adjustLine, approveRun, canEditRun, canPayRun, canReopenRun, deleteRun, payRun, reopenRun
} from "@/lib/sales/payout-run";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("reopen") }),
  z.object({
    action: z.literal("pay"),
    paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date the money left"),
    paymentMode: z.enum(PAYOUT_MODES),
    reference: z.string().trim().max(80).optional()
  }),
  z.object({
    action: z.literal("adjust"),
    line: z.string().regex(OBJECT_ID),
    adjustments: z.array(z.object({
      name: z.string().trim().min(2, "Say what the adjustment is for").max(80),
      amount: z.number()
    })).max(10),
    note: z.string().trim().max(300).optional()
  })
]);

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.viewSales);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Not a valid payout id");
    await connectDb();

    const run = await SalesPayout.findById(id)
      .populate("generatedBy approvedBy paidBy", "name")
      .lean() as { status?: string } | null;
    if (!run) return badRequest("No such payout run", 404);

    const lines = await SalesPayoutLine.find({ run: id }).populate("rep", "name code").sort({ net: -1 }).lean();

    return ok({
      run,
      lines,
      mayEdit: canEditRun(run.status) && can.runSalesPayout(auth.session.role),
      mayApprove: canEditRun(run.status) && can.approveSalesPayout(auth.session.role),
      mayReopen: canReopenRun(run.status) && can.approveSalesPayout(auth.session.role),
      mayPay: canPayRun(run.status) && can.approveSalesPayout(auth.session.role),
      mayDelete: canEditRun(run.status) && can.approveSalesPayout(auth.session.role)
    });
  } catch (error) {
    return fail(error);
  }
}

/**
 * `Draft → Approved → Paid`, with `Approved → Draft` allowed and **Paid
 * terminal**. Adjusting a line is a draft-only edit and needs only the
 * preparing authority; everything that moves the run's state needs the
 * approving one.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.runSalesPayout);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Not a valid payout id");
    await connectDb();

    const input = schema.parse(await request.json());
    const run = await SalesPayout.findById(id);
    if (!run) return badRequest("No such payout run", 404);

    if (input.action === "adjust") {
      if (!canEditRun(run.status)) return badRequest(`Payout ${run.payoutNo} is ${String(run.status).toLowerCase()}, so its lines can no longer be adjusted. Reopen it first.`);

      const line = await adjustLine(input.line, input.adjustments, input.note);
      if (!line) return badRequest("No such payout line", 404);
      if (String(line.run) !== id) return badRequest("That line belongs to a different payout run.");

      await record({
        actor: auth.session.userId, action: "sales.payout.adjusted",
        entityType: "SalesPayoutLine", entityId: input.line,
        metadata: { payoutNo: run.payoutNo, adjustments: input.adjustments, net: line.net }
      });
      return ok({ line: { _id: line._id, net: line.net, adjustments: line.adjustments } });
    }

    // Everything below releases or commits money.
    if (!can.approveSalesPayout(auth.session.role)) {
      return badRequest("Preparing a payout and approving it are deliberately different authorities. Ask an administrator to approve this run.", 403);
    }

    if (input.action === "approve") {
      if (!canEditRun(run.status)) return badRequest(`Only a draft can be approved. ${run.payoutNo} is ${String(run.status).toLowerCase()}.`);
      await approveRun(run, auth.session.userId);
      await record({ actor: auth.session.userId, action: "sales.payout.approved", entityType: "SalesPayout", entityId: id, metadata: { payoutNo: run.payoutNo, totals: run.totals } });
      return ok({ status: "Approved" });
    }

    if (input.action === "reopen") {
      if (!canReopenRun(run.status)) {
        return badRequest(run.status === "Paid"
          ? `${run.payoutNo} has been paid. Money that has left the company is corrected by a later adjustment, never by rewriting the run that sent it.`
          : `Only an approved run can be reopened. ${run.payoutNo} is ${String(run.status).toLowerCase()}.`);
      }
      await reopenRun(run);
      await record({ actor: auth.session.userId, action: "sales.payout.reopened", entityType: "SalesPayout", entityId: id, metadata: { payoutNo: run.payoutNo } });
      return ok({ status: "Draft" });
    }

    if (!canPayRun(run.status)) return badRequest(`${run.payoutNo} must be approved before it can be marked paid.`);
    await payRun(run, auth.session.userId, { paymentDate: input.paymentDate, paymentMode: input.paymentMode, reference: input.reference });
    await record({ actor: auth.session.userId, action: "sales.payout.paid", entityType: "SalesPayout", entityId: id, metadata: { payoutNo: run.payoutNo, ...input } });
    return ok({ status: "Paid" });
  } catch (error) {
    return fail(error);
  }
}

/** Drafts only. The commissions go back to payable and are re-priced on the way out. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.approveSalesPayout);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Not a valid payout id");
    await connectDb();

    const run = await SalesPayout.findById(id);
    if (!run) return badRequest("No such payout run", 404);
    if (!canEditRun(run.status)) return badRequest(`Only a draft can be deleted. ${run.payoutNo} is ${String(run.status).toLowerCase()}.`);

    await deleteRun(run);
    await record({ actor: auth.session.userId, action: "sales.payout.deleted", entityType: "SalesPayout", entityId: id, metadata: { payoutNo: run.payoutNo } });
    return ok({ deleted: true });
  } catch (error) {
    return fail(error);
  }
}
