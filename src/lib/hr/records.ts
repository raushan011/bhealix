import { Types } from "mongoose";
import { Attendance, Holiday, LeaveRequest } from "@/models/HR";
import { Visit } from "@/models/Visit";
import { inferredStatus, monthDays, type AttendanceStatus } from "./attendance";
import { leaveBalances, leaveYear, type LeaveLedgerRow, type LeaveType } from "./leave";

const objectId = (value: unknown) => new Types.ObjectId(String(value));

export type ResolvedDay = {
  date: string;
  status: AttendanceStatus | null;
  source: "Manual" | "Holiday" | "Leave" | "Auto" | null;
  note?: string;
};

/**
 * What each day of a month says, for a set of employees.
 *
 * A day can be claimed by four different things, so the order they are applied
 * in is the whole of the rule:
 *
 *   1. A mark made by hand always wins — somebody looked and decided.
 *   2. A company holiday, which nobody was expected to work.
 *   3. Approved leave, which marks itself so HR need not mark it twice.
 *   4. A completed visit, which is the rep's own work proving they were out.
 *
 * Anything left has no mark at all, which is honestly different from an
 * absence: it means nobody has said yet.
 */
export async function attendanceMonth(employeeIds: unknown[], year: number, month: number): Promise<Map<string, ResolvedDay[]>> {
  const days = monthDays(year, month);
  const first = days[0], last = days[days.length - 1];
  const ids = employeeIds.map(objectId);

  const [marks, holidays, leave, visits] = await Promise.all([
    Attendance.find({ employee: { $in: ids }, date: { $gte: first, $lte: last } })
      .select("employee date status note").lean() as unknown as Promise<
        Array<{ employee: unknown; date: string; status: AttendanceStatus; note?: string }>>,
    Holiday.find({ date: { $gte: first, $lte: last } }).select("date name").lean() as unknown as Promise<
      Array<{ date: string; name: string }>>,
    LeaveRequest.find({
      employee: { $in: ids }, status: "Approved",
      // Any request that touches the month, including one that spans its edges.
      fromDate: { $lte: last }, toDate: { $gte: first }
    }).select("employee fromDate toDate type halfDay").lean() as unknown as Promise<
      Array<{ employee: unknown; fromDate: string; toDate: string; type: LeaveType; halfDay?: string }>>,
    // One completed visit is enough to call the day worked, so this counts them
    // per person per day rather than fetching the visits themselves.
    Visit.aggregate<{ _id: { employee: unknown; date: string }; total: number }>([
      {
        $match: {
          employee: { $in: ids }, status: "Completed",
          plannedDate: { $gte: new Date(`${first}T00:00:00`), $lte: new Date(`${last}T23:59:59`) }
        }
      },
      {
        $group: {
          _id: {
            employee: "$employee",
            date: { $dateToString: { format: "%Y-%m-%d", date: "$plannedDate" } }
          },
          total: { $sum: 1 }
        }
      }
    ])
  ]);

  const key = (employee: unknown, date: string) => `${String(employee)}|${date}`;
  const markBy = new Map(marks.map(row => [key(row.employee, row.date), row]));
  const holidayBy = new Map(holidays.map(row => [row.date, row.name]));
  const visitBy = new Map(visits.map(row => [key(row._id.employee, row._id.date), row.total]));

  const leaveBy = new Map<string, { type: LeaveType; halfDay?: string }>();
  for (const request of leave) {
    for (const date of days) {
      if (date >= request.fromDate && date <= request.toDate) {
        leaveBy.set(key(request.employee, date), { type: request.type, halfDay: request.halfDay });
      }
    }
  }

  const result = new Map<string, ResolvedDay[]>();
  for (const employee of employeeIds) {
    const id = String(employee);
    result.set(id, days.map(date => {
      const mark = markBy.get(key(id, date));
      if (mark) return { date, status: mark.status, source: "Manual" as const, note: mark.note };

      const holiday = holidayBy.get(date);
      if (holiday) return { date, status: "Holiday" as const, source: "Holiday" as const, note: holiday };

      const onLeave = leaveBy.get(key(id, date));
      if (onLeave) {
        return {
          date,
          status: (onLeave.halfDay ? "Half day" : "On leave") as AttendanceStatus,
          source: "Leave" as const,
          note: `${onLeave.type} leave${onLeave.halfDay ? ` (${onLeave.halfDay})` : ""}`
        };
      }

      const worked = inferredStatus(visitBy.get(key(id, date)) ?? 0);
      return worked
        ? { date, status: worked, source: "Auto" as const, note: "Completed a visit" }
        : { date, status: null, source: null };
    }));
  }

  return result;
}

/** One person's leave position for a year, from the requests themselves. */
export async function leaveBalanceFor(employee: unknown, entitlement?: Partial<Record<LeaveType, number>>, year = leaveYear()) {
  const rows = await LeaveRequest.find({ employee: objectId(employee), leaveYear: year })
    .select("type status days").lean() as unknown as LeaveLedgerRow[];
  return leaveBalances(rows, entitlement ?? {});
}

/** Everyone off today, for the HR dashboard. */
export async function onLeaveToday(date: string) {
  return LeaveRequest.find({ status: "Approved", fromDate: { $lte: date }, toDate: { $gte: date } })
    .populate("employee", "name employeeId role")
    .select("employee type fromDate toDate halfDay").lean();
}
