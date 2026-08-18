import { connectDb } from "@/lib/db/mongoose";
import { SalesOrder } from "@/models/Sales";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { fail, ok, pageParams } from "@/lib/api";

/**
 * The payments desk: every delivered order waiting to be paid, and every one
 * that has been.
 *
 * Two lists rather than one filtered list, because they are read differently.
 * What is owed is worked through top to bottom, oldest delivery first, with the
 * partner's UPI id beside each amount so the transfer can be made from the same
 * screen. What has been paid is a ledger, newest first, and is where somebody
 * goes to answer "did we pay her for #1042" — so it carries the reference and
 * the day the money left.
 */
const REP_FIELDS = "name code active phone payMethod upiId bankName bankAccountName bankAccountNo bankIfsc";

export async function GET(request: Request) {
  try {
    const auth = await apiSession(can.viewSales);
    if ("response" in auth) return auth.response;
    await connectDb();

    const { page, limit, skip } = pageParams(request.url);

    const [owed, paid, paidTotal, totals] = await Promise.all([
      // Everything owed, unpaginated: this is a to-do list and it has to be
      // possible to see the bottom of it. It is bounded by how many parcels the
      // couriers deliver between one payment session and the next.
      SalesOrder.find({ "commission.status": "Payable", rep: { $ne: null } })
        .sort({ "delivery.at": 1, placedAt: 1 })
        .limit(500)
        .populate("rep", REP_FIELDS)
        .lean(),
      SalesOrder.find({ "commission.status": "Paid" })
        .sort({ "commission.payment.paidAt": -1 })
        .skip(skip)
        .limit(limit)
        .populate("rep", "name code active")
        .populate("commission.payment.paidBy", "name")
        .lean(),
      SalesOrder.countDocuments({ "commission.status": "Paid" }),
      SalesOrder.aggregate<{ _id: string; count: number; amount: number }>([
        { $match: { rep: { $ne: null } } },
        { $group: { _id: "$commission.status", count: { $sum: 1 }, amount: { $sum: "$commission.amount" } } }
      ])
    ]);

    const by = (status: string) => totals.find(row => row._id === status) ?? { count: 0, amount: 0 };
    const needsAttention = await SalesOrder.countDocuments({ "commission.needsReversal": true });

    return ok({
      owed,
      paid,
      paidTotal,
      page,
      pages: Math.max(1, Math.ceil(paidTotal / limit)),
      totals: {
        owed: { count: by("Payable").count, amount: Math.round(by("Payable").amount) },
        paid: { count: by("Paid").count, amount: Math.round(by("Paid").amount) },
        pending: { count: by("Pending").count, amount: Math.round(by("Pending").amount) },
        needsAttention
      },
      mayPay: can.paySalesCommission(auth.session.role)
    });
  } catch (error) {
    return fail(error);
  }
}
