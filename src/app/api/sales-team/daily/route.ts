import { Types } from "mongoose";
import { connectDb } from "@/lib/db/mongoose";
import { SalesTeamOrder } from "@/models/SalesTeam";
import { User } from "@/models/User";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok } from "@/lib/api";
import { dayRange, shiftDay, todayIso } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A range longer than this is cut to its last part: a table, not a ledger. */
const MAX_DAYS = 366;
const IMPORTED = ["Shopify", "Shiprocket"];

type Cell = { orders: number; value: number; cancelled: number };
const empty = (): Cell => ({ orders: 0, value: 0, cancelled: 0 });

/**
 * Orders placed day by day, and by whom — the desk's register of who sold what
 * on which day.
 *
 * One row per calendar day in India (an order placed at 11 pm counts for that
 * day, not the next), one column per executive for the orders they placed in
 * the CRM, one for orders that came in from the shop or Shiprocket, and the
 * day's total. Cancelled orders are counted, and shown, but add no value.
 */
export async function GET(request: Request) {
  try {
    const auth = await apiSession(can.viewSalesTeam);
    if ("response" in auth) return auth.response;
    await connectDb();

    const params = new URL(request.url).searchParams;
    const today = todayIso();
    let to = ISO_DAY.test(params.get("to") ?? "") ? params.get("to")! : today;
    let from = ISO_DAY.test(params.get("from") ?? "") ? params.get("from")! : shiftDay(to, -13);
    if (from > to) [from, to] = [to, from];
    if (from < shiftDay(to, -(MAX_DAYS - 1))) from = shiftDay(to, -(MAX_DAYS - 1));
    if (to > today) to = today;
    if (from > to) return badRequest("Choose a range that is not in the future.");

    const rows = await SalesTeamOrder.aggregate([
      { $match: { placedAt: dayRange(from, to) } },
      {
        $group: {
          _id: {
            day: { $dateToString: { format: "%Y-%m-%d", date: "$placedAt", timezone: "Asia/Kolkata" } },
            who: { $cond: [{ $in: ["$origin", IMPORTED] }, "imported", { $ifNull: [{ $toString: "$executive" }, "unassigned"] }] }
          },
          orders: { $sum: 1 },
          value: { $sum: { $cond: [{ $ifNull: ["$cancelledAt", false] }, 0, "$totals.paid"] } },
          cancelled: { $sum: { $cond: [{ $ifNull: ["$cancelledAt", false] }, 1, 0] } }
        }
      }
    ]) as Array<{ _id: { day: string; who: string }; orders: number; value: number; cancelled: number }>;

    // Every active executive gets a column, a quiet day included; a former one only if they sold in the range.
    const sold = [...new Set(rows.map(row => row._id.who).filter(who => Types.ObjectId.isValid(who)))];
    const people = await User.find({ $or: [{ role: "EXECUTIVE", active: { $ne: false } }, { _id: { $in: sold } }] })
      .select("name employeeId").sort({ name: 1 }).lean() as unknown as Array<{ _id: Types.ObjectId; name: string; employeeId?: string }>;
    const executives = people.map(person => ({ _id: String(person._id), name: person.name, employeeId: person.employeeId }));

    const byDay = new Map<string, Record<string, Cell>>();
    for (const row of rows) {
      const cells = byDay.get(row._id.day) ?? {};
      // An order placed in the CRM with no executive cannot happen; counted with the shop's should it ever.
      const who = row._id.who === "unassigned" ? "imported" : row._id.who;
      const cell = cells[who] ?? empty();
      cell.orders += row.orders; cell.value += row.value; cell.cancelled += row.cancelled;
      cells[who] = cell;
      byDay.set(row._id.day, cells);
    }

    const days: Array<{ day: string; cells: Record<string, Cell>; total: Cell }> = [];
    for (let day = to; day >= from; day = shiftDay(day, -1)) {
      const cells = byDay.get(day) ?? {};
      const total = Object.values(cells).reduce((sum, cell) => ({
        orders: sum.orders + cell.orders, value: sum.value + cell.value, cancelled: sum.cancelled + cell.cancelled
      }), empty());
      days.push({ day, cells, total });
    }

    const columns = [...executives.map(person => person._id), "imported"];
    const totals = Object.fromEntries(columns.map(key => [key, days.reduce((sum, row) => {
      const cell = row.cells[key];
      return cell ? { orders: sum.orders + cell.orders, value: sum.value + cell.value, cancelled: sum.cancelled + cell.cancelled } : sum;
    }, empty())]));
    const grand = days.reduce((sum, row) => ({
      orders: sum.orders + row.total.orders, value: sum.value + row.total.value, cancelled: sum.cancelled + row.total.cancelled
    }), empty());

    return ok({ from, to, executives, days, totals, grand });
  } catch (error) {
    return fail(error);
  }
}
