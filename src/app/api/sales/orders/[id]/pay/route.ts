import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { record } from "@/lib/audit";
import { PAYOUT_MODES } from "@/lib/sales/constants";
import { payCommission, unpayCommission } from "@/lib/sales/commission-payment";
import { todayIso } from "@/lib/time";

const schema = z.object({
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the day the money left").optional(),
  mode: z.enum(PAYOUT_MODES),
  reference: z.string().trim().max(80).optional(),
  note: z.string().trim().max(300).optional()
});

/**
 * Marks one order's commission paid.
 *
 * The money has already moved — by UPI, by bank transfer, from somebody's
 * phone — and this is the record that it did: when, how, and under what
 * reference. The partner is shown the same fields on their own screen the
 * moment it is saved, so what they are told they were paid is what was written
 * down when it was paid.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.paySalesCommission);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Not a valid order id");
    await connectDb();

    const input = schema.parse(await request.json().catch(() => ({})));
    const paymentDate = input.paymentDate ?? todayIso();
    if (paymentDate > todayIso()) return badRequest("A payment cannot be dated in the future.");

    const outcome = await payCommission(id, auth.session.userId, { ...input, paymentDate });
    if (!outcome.ok) return badRequest(outcome.reason, outcome.status);

    await record({
      actor: auth.session.userId,
      action: "sales.commission.paid",
      entityType: "SalesOrder",
      entityId: id,
      metadata: { order: outcome.order.name, rep: String(outcome.order.rep), amount: outcome.order.commission.amount, paymentDate, mode: input.mode, reference: input.reference }
    });

    return ok({ _id: id, status: "Paid" });
  } catch (error) {
    return fail(error);
  }
}

/**
 * Takes a payment back — for the wrong order marked, or a transfer that
 * bounced. Not for a parcel that came back after it was paid: that is money to
 * recover by agreement, and the order is flagged for it rather than unpaid.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.paySalesCommission);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Not a valid order id");
    await connectDb();

    const outcome = await unpayCommission(id);
    if (!outcome.ok) return badRequest(outcome.reason, outcome.status);

    await record({
      actor: auth.session.userId,
      action: "sales.commission.unpaid",
      entityType: "SalesOrder",
      entityId: id,
      metadata: { order: outcome.order.name, rep: String(outcome.order.rep), amount: outcome.order.commission.amount, now: outcome.order.commission.status }
    });

    return ok({ _id: id, status: outcome.order.commission.status });
  } catch (error) {
    return fail(error);
  }
}
