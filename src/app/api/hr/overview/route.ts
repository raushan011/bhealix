import { connectDb } from "@/lib/db/mongoose";
import { User } from "@/models/User";
import { Attendance, Holiday, LeaveRequest } from "@/models/HR";
import { Visit } from "@/models/Visit";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok } from "@/lib/api";
import { ROLES } from "@/constants/access";
import { todayIso } from "@/lib/time";

/** The figures the HR desk opens the day with. */
export async function GET() {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    if (!can.viewHr(auth.session.role)) return badRequest("You do not have access to this action", 403);

    await connectDb();
    const today = todayIso();
    const dayStart = new Date(`${today}T00:00:00`), dayEnd = new Date(`${today}T23:59:59`);
    // Birthdays and work anniversaries are matched on the month and day alone.
    const monthDay = today.slice(5);

    const [byRole, active, inactive, pendingLeave, onLeave, marked, workedToday, holiday, joinedThisMonth, birthdays] =
      await Promise.all([
        User.aggregate<{ _id: string; total: number }>([
          { $match: { active: true } },
          { $group: { _id: "$role", total: { $sum: 1 } } }
        ]),
        User.countDocuments({ active: true }),
        User.countDocuments({ active: false }),
        LeaveRequest.countDocuments({ status: "Pending" }),
        LeaveRequest.find({ status: "Approved", fromDate: { $lte: today }, toDate: { $gte: today } })
          .populate("employee", "name employeeId role").select("employee type fromDate toDate halfDay").lean(),
        Attendance.find({ date: today }).select("employee status").lean() as unknown as
          Promise<Array<{ employee: unknown; status: string }>>,
        // Anyone who has completed a visit today is out working, whatever the
        // attendance sheet says yet.
        Visit.distinct("employee", { status: "Completed", plannedDate: { $gte: dayStart, $lte: dayEnd } }),
        Holiday.findOne({ date: today }).select("name").lean() as Promise<{ name: string } | null>,
        User.find({ active: true, joiningDate: { $regex: `^${today.slice(0, 7)}` } })
          .select("name employeeId joiningDate designation").sort({ joiningDate: 1 }).lean(),
        User.find({ active: true, dateOfBirth: { $regex: `-${monthDay}$` } })
          .select("name employeeId dateOfBirth").lean()
      ]);

    const roleCounts = Object.fromEntries(ROLES.map(role => [role, 0])) as Record<string, number>;
    for (const row of byRole) roleCounts[row._id] = row.total;

    const absentToday = marked.filter(row => row.status === "Absent").length;
    // Present is either marked so, or proven by a completed visit.
    const presentIds = new Set([
      ...marked.filter(row => row.status === "Present" || row.status === "Half day").map(row => String(row.employee)),
      ...workedToday.map(id => String(id))
    ]);

    return ok({
      today,
      headcount: { active, inactive, byRole: roleCounts },
      pendingLeave,
      onLeave,
      presentToday: presentIds.size,
      absentToday,
      unmarked: Math.max(0, active - presentIds.size - absentToday - onLeave.length),
      holiday: holiday?.name ?? null,
      joinedThisMonth,
      birthdays
    });
  } catch (error) {
    return fail(error);
  }
}
