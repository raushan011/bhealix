import { Types } from "mongoose";
import { connectDb } from "@/lib/db/mongoose";
import { SalesLead } from "@/models/Sales";
import { SalesTeamOrder } from "@/models/SalesTeam";
import { apiSession } from "@/lib/auth/guard";
import { usesExecutivePanel } from "@/constants/access";
import { badRequest, fail, ok } from "@/lib/api";
import { dueOn, isOutForDelivery, needsAction } from "@/lib/sales-team/risk";
import { shiftDay, todayIso } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ORDER_FIELDS = "name placedAt customer totals paymentMode collectAmount shipment.awb shipment.courier shipment.status "
  + "shipment.expectedDelivery shipment.lastError delivery.state rtoRisk.level ndr incentive.amount incentive.status cancelledAt";

type Row = {
  _id: Types.ObjectId; name: string; customer?: { name?: string; phone?: string; city?: string };
  collectAmount?: number; paymentMode: string; totals: { paid: number };
  shipment?: { awb?: string; courier?: string; status?: string; expectedDelivery?: string; lastError?: string };
  delivery: { state: string }; rtoRisk?: { level?: string }; ndr?: Array<{ at: Date; action: string; deferredDate?: string }>;
};

/**
 * The executive's day, on one screen.
 *
 * Four lists, each a reason to pick up the phone: parcels reaching customers
 * today (ring them to be in and have the cash ready), failed deliveries waiting
 * on an instruction (ring and reschedule before they turn into returns), orders
 * still not booked, and follow-ups whose day has come. Plus the month so far.
 */
export async function GET() {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    if (!usesExecutivePanel(auth.session.role)) return badRequest("This is the sales executive's own screen", 403);
    await connectDb();

    const me = new Types.ObjectId(auth.session.userId);
    const today = todayIso();
    const monthStart = new Date(`${today.slice(0, 8)}01T00:00:00+05:30`);

    const [moving, unbooked, followUps, upcoming, month] = await Promise.all([
      SalesTeamOrder.find({ executive: me, cancelledAt: null, "shipment.awb": { $nin: [null, ""] }, "delivery.state": { $in: ["Awaiting", "In transit", "Undelivered"] } })
        .select(ORDER_FIELDS).sort({ "shipment.expectedDelivery": 1, placedAt: 1 }).limit(200).lean() as unknown as Promise<Row[]>,
      SalesTeamOrder.find({ executive: me, cancelledAt: null, "shipment.awb": { $in: [null, ""] } })
        .select(ORDER_FIELDS).sort({ placedAt: 1 }).limit(50).lean() as unknown as Promise<Row[]>,
      SalesLead.find({ assignedTo: me, followUpAt: { $lte: today }, status: { $nin: ["Converted", "Not interested"] } })
        .select("name phone city type status followUpAt followUpNote lastContactedAt").sort({ followUpAt: 1 }).limit(100).lean(),
      SalesLead.countDocuments({ assignedTo: me, followUpAt: { $gt: today, $lte: shiftDay(today, 7) }, status: { $nin: ["Converted", "Not interested"] } }),
      SalesTeamOrder.aggregate([
        { $match: { executive: me, placedAt: { $gte: monthStart } } },
        {
          $group: {
            _id: null,
            orders: { $sum: { $cond: [{ $ifNull: ["$cancelledAt", false] }, 0, 1] } },
            value: { $sum: { $cond: [{ $ifNull: ["$cancelledAt", false] }, 0, "$totals.paid"] } },
            delivered: { $sum: { $cond: [{ $eq: ["$delivery.state", "Delivered"] }, 1, 0] } },
            returned: { $sum: { $cond: [{ $in: ["$delivery.state", ["RTO", "Returned"]] }, 1, 0] } },
            pending: { $sum: { $cond: [{ $eq: ["$incentive.status", "Pending"] }, "$incentive.amount", 0] } },
            payable: { $sum: { $cond: [{ $eq: ["$incentive.status", "Payable"] }, "$incentive.amount", 0] } },
            paid: { $sum: { $cond: [{ $eq: ["$incentive.status", "Paid"] }, "$incentive.amount", 0] } }
          }
        }
      ])
    ]);

    const problems = moving.filter(order => needsAction(order.shipment?.status, order.delivery.state));
    const flagged = new Set(problems.map(order => String(order._id)));
    const deliveringToday = moving.filter(order => !flagged.has(String(order._id))
      && (isOutForDelivery(order.shipment?.status) || dueOn(order.shipment?.expectedDelivery, today)));
    const tomorrow = moving.filter(order => !flagged.has(String(order._id)) && dueOn(order.shipment?.expectedDelivery, shiftDay(today, 1)));

    return ok({
      today,
      deliveringToday,
      tomorrow,
      problems,
      unbooked,
      followUps,
      upcomingFollowUps: upcoming,
      inTransit: moving.length,
      month: month[0] ?? { orders: 0, value: 0, delivered: 0, returned: 0, pending: 0, payable: 0, paid: 0 }
    });
  } catch (error) {
    return fail(error);
  }
}
