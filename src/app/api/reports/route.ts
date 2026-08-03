import { connectDb } from "@/lib/db/mongoose";
import { Visit } from "@/models/Visit";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { fail, ok } from "@/lib/api";
import { movementTotalsByEmployee } from "@/lib/samples/ledger";

/**
 * One query pass over a date range, returning the four things an administrator
 * asks about a field team: who worked, what happened, what was handed out, and
 * how doctors responded.
 */
export async function GET(request: Request) {
  try {
    const auth = await apiSession(can.viewAllReports);
    if ("response" in auth) return auth.response;
    await connectDb();

    const params = new URL(request.url).searchParams;
    const to = params.get("to") ?? new Date().toISOString().slice(0, 10);
    const from = params.get("from") ?? new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    const range = { $gte: new Date(`${from}T00:00:00`), $lte: new Date(`${to}T23:59:59`) };

    const [totals, byEmployee, byOutcome, samples, byInterest, stockTotals] = await Promise.all([
      Visit.aggregate([
        { $match: { plannedDate: range } },
        { $group: {
          _id: null,
          planned: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ["$status", "Completed"] }, 1, 0] } },
          missed: { $sum: { $cond: [{ $eq: ["$status", "Missed"] }, 1, 0] } },
          orderValue: { $sum: { $ifNull: ["$orderValue", 0] } }
        } }
      ]),
      Visit.aggregate([
        { $match: { plannedDate: range } },
        { $group: {
          _id: "$employee",
          planned: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ["$status", "Completed"] }, 1, 0] } },
          samples: { $sum: { $sum: "$samples.quantity" } },
          orderValue: { $sum: { $ifNull: ["$orderValue", 0] } }
        } },
        { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "employee" } },
        { $unwind: "$employee" },
        { $project: { name: "$employee.name", employeeId: "$employee.employeeId", planned: 1, completed: 1, samples: 1, orderValue: 1 } },
        { $sort: { completed: -1 } }
      ]),
      Visit.aggregate([
        { $match: { plannedDate: range, status: "Completed", outcome: { $ne: null } } },
        { $group: { _id: "$outcome", count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      Visit.aggregate([
        { $match: { plannedDate: range, status: "Completed" } },
        { $unwind: "$samples" },
        { $group: { _id: "$samples.product", quantity: { $sum: "$samples.quantity" }, doctors: { $addToSet: "$doctor" } } },
        { $project: { product: "$_id", quantity: 1, doctorCount: { $size: "$doctors" }, _id: 0 } },
        { $sort: { quantity: -1 } }
      ]),
      Visit.aggregate([
        { $match: { plannedDate: range, status: "Completed", interest: { $ne: null } } },
        { $group: { _id: "$interest", count: { $sum: 1 } } }
      ]),
      movementTotalsByEmployee(range)
    ]);

    // Each rep's row carries both halves: what they were issued and what reached a doctor.
    const withStock = byEmployee.map(row => {
      const stock = stockTotals.get(String(row._id));
      return {
        ...row,
        samplesIssued: stock?.issued ?? 0,
        samplesDispensed: stock?.dispensed ?? 0,
        samplesReturned: stock?.returned ?? 0,
        samplesInHand: (stock?.issued ?? 0) - (stock?.dispensed ?? 0) - (stock?.returned ?? 0)
      };
    });

    return ok({
      from, to,
      totals: totals[0] ?? { planned: 0, completed: 0, missed: 0, orderValue: 0 },
      byEmployee: withStock, byOutcome, samples, byInterest
    });
  } catch (error) {
    return fail(error);
  }
}
