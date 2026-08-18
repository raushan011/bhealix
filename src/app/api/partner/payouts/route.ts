import { Types } from "mongoose";
import { connectDb } from "@/lib/db/mongoose";
import { SalesOrder } from "@/models/Sales";
import { apiPartner } from "@/lib/auth/partner";
import { fail, ok } from "@/lib/api";
import { commissionForPartner } from "@/lib/sales/commission-payment";

const FIELDS = "name placedAt couponCode items shipment.deliveredAt delivery.at delivery.state commission";

/**
 * What this rep is owed and what they have been paid, order by order.
 *
 * Two lists, the same two the administrator works from — so when a partner asks
 * "have you paid me for #1042", both sides are looking at the same line. Owed
 * is every delivered order not yet paid; paid is every one that has been, with
 * the day, the mode and the reference the money went out under, which is what
 * they need to find it in their own bank app.
 *
 * Nothing here is a promise about a parcel still in transit. Those are on the
 * orders screen, and they are worth nothing until the courier says delivered.
 */
export async function GET() {
  try {
    const auth = await apiPartner();
    if ("response" in auth) return auth.response;
    await connectDb();

    const rep = new Types.ObjectId(String(auth.rep._id));

    const [owed, paid, totals] = await Promise.all([
      SalesOrder.find({ rep, "commission.status": "Payable" })
        .select(FIELDS).sort({ "delivery.at": 1, placedAt: 1 }).limit(200).lean(),
      SalesOrder.find({ rep, "commission.status": "Paid" })
        .select(FIELDS).sort({ "commission.payment.paidAt": -1 }).limit(200).lean(),
      SalesOrder.aggregate<{ _id: string; count: number; amount: number }>([
        { $match: { rep } },
        { $group: { _id: "$commission.status", count: { $sum: 1 }, amount: { $sum: "$commission.amount" } } }
      ])
    ]);

    const by = (status: string) => totals.find(row => row._id === status) ?? { count: 0, amount: 0 };
    const strip = (order: (typeof owed)[number]) => commissionForPartner(order as { commission?: { payment?: { paidBy?: unknown } } });

    return ok({
      owed: owed.map(strip),
      paid: paid.map(strip),
      totals: {
        owed: { count: by("Payable").count, amount: Math.round(by("Payable").amount) },
        paid: { count: by("Paid").count, amount: Math.round(by("Paid").amount) },
        pending: { count: by("Pending").count, amount: Math.round(by("Pending").amount) }
      }
    });
  } catch (error) {
    return fail(error);
  }
}
