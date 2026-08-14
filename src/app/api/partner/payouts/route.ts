import { Types } from "mongoose";
import { connectDb } from "@/lib/db/mongoose";
import { SalesPayout, SalesPayoutLine } from "@/models/Sales";
import { apiPartner } from "@/lib/auth/partner";
import { fail, ok } from "@/lib/api";

/**
 * What this rep has actually been paid, and what is on its way.
 *
 * **Draft runs are not shown, on purpose.** A draft is working material: it can
 * be regenerated, an order on it can be voided by a return that arrives
 * tomorrow, and the figure on it is nobody's promise yet. Showing a rep a number
 * that later goes down is the fastest way to lose their trust in every other
 * number in this portal. They see a run once it has been approved — at which
 * point the amount is frozen and the company has committed to it.
 *
 * The lines carry the orders they were built from, copied onto the line when the
 * run was generated rather than joined now. That is what lets somebody ask in
 * November what the ₹1,800 paid in August was made of and get the four orders
 * exactly as they stood, rather than a fresh query that a later refund would
 * answer differently.
 */
export async function GET() {
  try {
    const auth = await apiPartner();
    if ("response" in auth) return auth.response;
    await connectDb();

    const lines = await SalesPayoutLine.find({ rep: new Types.ObjectId(String(auth.rep._id)) })
      .sort({ createdAt: -1 })
      .limit(60)
      .populate({ path: "run", model: SalesPayout, select: "payoutNo from to status paidAt paymentDate paymentMode reference approvedAt" })
      .lean() as { run?: { status?: string } | null }[];

    const released = lines.filter(line => line.run && line.run.status !== "Draft");

    const paid = released
      .filter(line => line.run?.status === "Paid")
      .reduce((running, line) => running + Number((line as { net?: number }).net ?? 0), 0);
    const onTheWay = released
      .filter(line => line.run?.status === "Approved")
      .reduce((running, line) => running + Number((line as { net?: number }).net ?? 0), 0);

    return ok({ lines: released, totals: { paid: Math.round(paid), onTheWay: Math.round(onTheWay) } });
  } catch (error) {
    return fail(error);
  }
}
