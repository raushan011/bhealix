import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { Invoice } from "@/models/Invoice";
import { apiSession } from "@/lib/auth/guard";
import { can, usesFieldPanel } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { fromDateInput } from "@/lib/time";
import {
  appendFollowUp, FOLLOW_UP_LIMIT, nextFollowUp, syncFollowUpDate, type FollowUpLike
} from "@/lib/billing/follow-ups";

/**
 * The chases scheduled against one bill.
 *
 * Its own route rather than a corner of `PATCH /api/invoices/[id]` because the
 * people who schedule a chase are not the people who may rewrite a bill. The rep
 * standing in the clinic is the one who hears "come back after the 15th", and
 * they hold `recordPayment` over their own bills and nothing more. Scheduling a
 * call changes no figure on the bill, so there is nothing here to protect from
 * them — and the alternative was a rep who could take the money but not write
 * down when the rest of it was promised.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const addSchema = z.object({
  date: z.string().regex(ISO_DATE, "Choose the date to chase this on"),
  note: z.string().trim().max(200).optional(),
  /**
   * Moves the bill's own payment due date to the same day — for the case where
   * the doctor has not just asked for a call but renegotiated when the money is
   * due. Changing what the bill says is the administrator's, so it is refused
   * rather than quietly dropped for anybody else.
   */
  moveDueDate: z.boolean().optional()
});

const editSchema = z.object({
  date: z.string().regex(ISO_DATE).optional(),
  note: z.string().trim().max(200).nullable().optional(),
  /** Marks the call as made, or puts it back on the list. */
  done: z.boolean().optional()
});

/** The bill, if this session is allowed to schedule chases against it. */
async function reachable(id: string) {
  const auth = await apiSession(can.recordPayment);
  if ("response" in auth) return { response: auth.response };
  if (!OBJECT_ID.test(id)) return { response: badRequest("Invalid invoice reference") };

  await connectDb();
  const invoice = await Invoice.findById(id);
  if (!invoice) return { response: badRequest("Invoice not found", 404) };

  // A rep chases their own bills; the administrator any of them.
  if (usesFieldPanel(auth.session.role) && String(invoice.employee) !== auth.session.userId) {
    return { response: badRequest("You can only schedule follow-ups on your own bills", 403) };
  }
  if (invoice.cancelledAt) return { response: badRequest("This bill has been cancelled, so there is nothing to chase") };

  return { auth, invoice };
}

/** What every one of these returns: the list as it now stands, and the next chase. */
function state(invoice: { followUps?: FollowUpLike[] | null; followUpDate?: Date | null; dueDate?: Date | null }) {
  return {
    followUps: invoice.followUps ?? [],
    followUpDate: invoice.followUpDate ?? null,
    dueDate: invoice.dueDate ?? null,
    next: nextFollowUp(invoice.followUps) ?? null
  };
}

/** Schedules one more chase. The path taken straight after money is received. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const found = await reachable(id);
    if ("response" in found) return found.response;
    const { auth, invoice } = found;

    const input = addSchema.parse(await request.json());
    if (invoice.followUps.length >= FOLLOW_UP_LIMIT) {
      return badRequest(`This bill already carries ${FOLLOW_UP_LIMIT} follow-ups. Mark the ones you have made as done first.`);
    }
    if (input.moveDueDate && !can.manageBilling(auth.session.role)) {
      return badRequest("Only an administrator can move the payment due date on a bill", 403);
    }

    appendFollowUp(invoice, { date: input.date, note: input.note }, auth.session.userId);
    if (input.moveDueDate) invoice.dueDate = fromDateInput(input.date);
    await invoice.save();

    return ok(state(invoice), 201);
  } catch (error) {
    return fail(error);
  }
}

/** Marks a chase as made, or moves it. Rescheduling is the commonest thing anybody does here. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    // Authorised first, then read: a caller with no business here is refused
    // before anything they sent is so much as looked at.
    const found = await reachable(id);
    if ("response" in found) return found.response;
    const { invoice } = found;

    const followUpId = new URL(request.url).searchParams.get("followUp") ?? "";
    if (!OBJECT_ID.test(followUpId)) return badRequest("Invalid follow-up reference");

    const entry = invoice.followUps.id(followUpId);
    if (!entry) return badRequest("Follow-up not found", 404);

    const input = editSchema.parse(await request.json());
    if (input.date !== undefined) entry.date = fromDateInput(input.date);
    if (input.note !== undefined) entry.note = input.note || undefined;
    // Marking one made twice must not move the day it was made on.
    if (input.done === true) entry.doneAt = entry.doneAt ?? new Date();
    if (input.done === false) entry.doneAt = undefined;

    syncFollowUpDate(invoice);
    await invoice.save();

    return ok(state(invoice));
  } catch (error) {
    return fail(error);
  }
}

/** Drops a chase agreed by mistake. Nothing about the bill's money moves with it. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const found = await reachable(id);
    if ("response" in found) return found.response;
    const { invoice } = found;

    const followUpId = new URL(request.url).searchParams.get("followUp") ?? "";
    if (!OBJECT_ID.test(followUpId)) return badRequest("Invalid follow-up reference");

    const before = invoice.followUps.length;
    invoice.followUps.pull({ _id: followUpId });
    if (invoice.followUps.length === before) return badRequest("Follow-up not found", 404);

    syncFollowUpDate(invoice);
    await invoice.save();

    return ok(state(invoice));
  } catch (error) {
    return fail(error);
  }
}
