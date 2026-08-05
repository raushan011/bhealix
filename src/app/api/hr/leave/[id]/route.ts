import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { LeaveRequest } from "@/models/HR";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { canCancel, canDecide } from "@/lib/hr/leave";

const schema = z.object({
  action: z.enum(["approve", "reject", "cancel"]),
  note: z.string().trim().max(300).optional()
});

/**
 * Decides a request, or withdraws it.
 *
 * Approving and refusing belong to the HR desk; withdrawing belongs to the
 * person who asked. Both are only possible while the request is still pending —
 * a decision already taken is corrected by asking again, so the record of what
 * was decided, and by whom, stays intact.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Invalid leave reference");

    await connectDb();
    const leave = await LeaveRequest.findById(id);
    if (!leave) return badRequest("Leave request not found", 404);

    const { action, note } = schema.parse(await request.json());
    const isOwner = String(leave.employee) === auth.session.userId;

    if (action === "cancel") {
      if (!isOwner && !can.manageLeave(auth.session.role)) {
        return badRequest("You can only withdraw your own leave request", 403);
      }
      if (!canCancel(leave.status)) return badRequest(`This request has already been ${leave.status.toLowerCase()}`);
      leave.status = "Cancelled";
      leave.decidedBy = auth.session.userId;
      leave.decidedAt = new Date();
      leave.decisionNote = note;
      await leave.save();
      return ok({ status: leave.status });
    }

    if (!can.manageLeave(auth.session.role)) return badRequest("You do not have access to this action", 403);
    // Signing off your own leave is not a decision anybody should be making.
    if (isOwner) return badRequest("You cannot decide your own leave request. Ask another administrator.");
    if (!canDecide(leave.status)) return badRequest(`This request has already been ${leave.status.toLowerCase()}`);

    leave.status = action === "approve" ? "Approved" : "Rejected";
    leave.decidedBy = auth.session.userId;
    leave.decidedAt = new Date();
    leave.decisionNote = note;
    await leave.save();

    return ok({ status: leave.status });
  } catch (error) {
    return fail(error);
  }
}

/** Removes a request outright. Only ever the person's own, and only while pending. */
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Invalid leave reference");

    await connectDb();
    const leave = await LeaveRequest.findById(id).select("employee status").lean() as
      { employee: unknown; status: string } | null;
    if (!leave) return badRequest("Leave request not found", 404);

    const isOwner = String(leave.employee) === auth.session.userId;
    if (!isOwner && !can.manageLeave(auth.session.role)) return badRequest("You do not have access to this action", 403);
    if (leave.status !== "Pending") {
      return badRequest("A decided request is kept as a record. Withdraw it instead if it is still pending.");
    }

    await LeaveRequest.findByIdAndDelete(id);
    return ok({ deleted: true });
  } catch (error) {
    return fail(error);
  }
}
