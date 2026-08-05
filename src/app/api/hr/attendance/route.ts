import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { Attendance } from "@/models/HR";
import { User } from "@/models/User";
import { apiSession } from "@/lib/auth/guard";
import { can, usesFieldPanel } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { ATTENDANCE_STATUSES, parseMonth, summariseAttendance } from "@/lib/hr/attendance";
import { attendanceMonth } from "@/lib/hr/records";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const schema = z.object({
  employee: z.string().regex(OBJECT_ID, "Choose an employee"),
  date: z.string().regex(ISO_DATE, "Enter a valid date"),
  status: z.enum(ATTENDANCE_STATUSES),
  note: z.string().trim().max(300).optional()
});

/** A month of attendance for the whole team, or for one person. */
export async function GET(request: Request) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    await connectDb();

    const params = new URL(request.url).searchParams;
    const month = parseMonth(params.get("month") ?? "");
    if (!month) return badRequest("Give the month as yyyy-mm");

    const requested = params.get("employee") ?? "";
    // Field staff read their own record and nobody else's.
    const own = usesFieldPanel(auth.session.role) || !can.manageAttendance(auth.session.role);
    const filter = own
      ? { _id: auth.session.userId }
      : OBJECT_ID.test(requested) ? { _id: requested } : { active: true };

    const staff = await User.find(filter).select("name employeeId role active").sort({ name: 1 }).lean() as
      unknown as Array<{ _id: unknown; name: string; employeeId: string; role: string; active: boolean }>;
    if (!staff.length) return ok({ month: params.get("month"), rows: [] });

    const resolved = await attendanceMonth(staff.map(person => person._id), month.year, month.month);

    const rows = staff.map(person => {
      const days = resolved.get(String(person._id)) ?? [];
      return {
        employee: String(person._id),
        name: person.name,
        employeeId: person.employeeId,
        role: person.role,
        days,
        // Days nobody has spoken for are left out of the summary rather than
        // counted as absences — an unmarked day is a gap, not a judgement.
        summary: summariseAttendance(days
          .filter(day => day.status !== null)
          .map(day => ({ date: day.date, status: day.status! })))
      };
    });

    return ok({ month: params.get("month"), rows });
  } catch (error) {
    return fail(error);
  }
}

/**
 * Marks a day, or corrects one already marked.
 *
 * An upsert on (employee, date): marking the same day twice is a correction,
 * never a second row, and the unique index makes that true even if two people
 * press save at the same moment.
 */
export async function POST(request: Request) {
  try {
    const auth = await apiSession(can.manageAttendance);
    if ("response" in auth) return auth.response;
    await connectDb();

    const input = schema.parse(await request.json());
    const person = await User.findById(input.employee).select("name active").lean() as
      { name: string; active: boolean } | null;
    if (!person) return badRequest("Employee not found", 404);

    const record = await Attendance.findOneAndUpdate(
      { employee: input.employee, date: input.date },
      { $set: { status: input.status, note: input.note, source: "Manual", markedBy: auth.session.userId } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();

    return ok({ record, name: person.name }, 201);
  } catch (error) {
    return fail(error);
  }
}

/** Removes a hand-made mark, letting the day fall back to what the work implies. */
export async function DELETE(request: Request) {
  try {
    const auth = await apiSession(can.manageAttendance);
    if ("response" in auth) return auth.response;
    await connectDb();

    const params = new URL(request.url).searchParams;
    const employee = params.get("employee") ?? "", date = params.get("date") ?? "";
    if (!OBJECT_ID.test(employee) || !ISO_DATE.test(date)) return badRequest("Invalid attendance reference");

    await Attendance.deleteOne({ employee, date });
    return ok({ cleared: true });
  } catch (error) {
    return fail(error);
  }
}
