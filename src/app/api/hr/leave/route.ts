import { z } from "zod";
import { Types, type FilterQuery } from "mongoose";
import { connectDb } from "@/lib/db/mongoose";
import { LeaveRequest } from "@/models/HR";
import { User } from "@/models/User";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID, pageParams } from "@/lib/api";
import {
  HALF_DAY_OPTIONS, LEAVE_STATUSES, LEAVE_TYPES, isCounted, leaveDays, leaveYear, overlaps, type LeaveType
} from "@/lib/hr/leave";
import { leaveBalanceFor } from "@/lib/hr/records";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const schema = z.object({
  /** HR may file a request on somebody's behalf; everybody else files their own. */
  employee: z.string().regex(OBJECT_ID).optional(),
  type: z.enum(LEAVE_TYPES),
  fromDate: z.string().regex(ISO_DATE, "Enter a valid start date"),
  toDate: z.string().regex(ISO_DATE, "Enter a valid end date"),
  halfDay: z.enum(HALF_DAY_OPTIONS).optional(),
  reason: z.string().trim().min(3, "Say why you need the time off").max(500),
  contactNumber: z.string().trim().max(40).optional()
});

export async function GET(request: Request) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    await connectDb();

    const { page, limit, skip } = pageParams(request.url);
    const params = new URL(request.url).searchParams;
    const filter: FilterQuery<Record<string, unknown>> = {};

    // The HR desk sees everybody's; everybody else sees only their own.
    if (can.manageLeave(auth.session.role)) {
      const employee = params.get("employee");
      if (employee && OBJECT_ID.test(employee)) filter.employee = new Types.ObjectId(employee);
    } else {
      filter.employee = new Types.ObjectId(auth.session.userId);
    }

    const status = params.get("status");
    if (status && (LEAVE_STATUSES as readonly string[]).includes(status)) filter.status = status;
    const type = params.get("type");
    if (type && (LEAVE_TYPES as readonly string[]).includes(type)) filter.type = type;
    const year = params.get("year");
    if (year) filter.leaveYear = year;

    const [items, total, pending] = await Promise.all([
      LeaveRequest.find(filter)
        .populate("employee", "name employeeId role")
        .populate("decidedBy", "name")
        .sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      LeaveRequest.countDocuments(filter),
      LeaveRequest.countDocuments({ ...filter, status: "Pending" })
    ]);

    // The person's own balance travels with their list, so the phone can show
    // what is left without a second call.
    const owner = String(filter.employee ?? auth.session.userId);
    const entitlement = await User.findById(owner).select("leaveEntitlement").lean() as
      { leaveEntitlement?: Partial<Record<LeaveType, number>> } | null;
    const balances = await leaveBalanceFor(owner, entitlement?.leaveEntitlement, year || leaveYear());

    return ok({ items, total, page, pages: Math.max(1, Math.ceil(total / limit)), pending, balances });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await apiSession(can.applyLeave);
    if ("response" in auth) return auth.response;
    await connectDb();

    const input = schema.parse(await request.json());
    // Only the HR desk may file for somebody else.
    const employee = input.employee && can.manageLeave(auth.session.role) ? input.employee : auth.session.userId;

    if (input.toDate < input.fromDate) return badRequest("The end date cannot be before the start date");
    const days = leaveDays(input.fromDate, input.toDate, input.halfDay);
    if (!days) return badRequest("That date range does not cover any days");
    if (days > 90) return badRequest("Ninety days is the most that can be asked for in one request");

    const person = await User.findById(employee).select("name active leaveEntitlement").lean() as
      { name: string; active: boolean; leaveEntitlement?: Partial<Record<LeaveType, number>> } | null;
    if (!person) return badRequest("Employee not found", 404);
    if (!person.active) return badRequest(`${person.name} is deactivated`);

    // Asking twice for the same day is a mistake worth catching here, not after
    // two approvals have quietly spent the balance twice.
    const existing = await LeaveRequest.find({
      employee, status: { $in: ["Pending", "Approved"] },
      fromDate: { $lte: input.toDate }, toDate: { $gte: input.fromDate }
    }).select("fromDate toDate status").lean() as unknown as Array<{ fromDate: string; toDate: string; status: string }>;

    const clash = existing.find(row => overlaps({ from: row.fromDate, to: row.toDate }, { from: input.fromDate, to: input.toDate }));
    if (clash) {
      return badRequest(`A ${clash.status.toLowerCase()} request already covers ${clash.fromDate} to ${clash.toDate}`);
    }

    const year = leaveYear(input.fromDate);
    if (isCounted(input.type)) {
      const balances = await leaveBalanceFor(employee, person.leaveEntitlement, year);
      const balance = balances.find(row => row.type === input.type);
      if (balance && days > balance.available) {
        return badRequest(
          `Only ${balance.available} day(s) of ${input.type.toLowerCase()} leave are left this year. Ask for unpaid leave instead, or shorten the request.`);
      }
    }

    const created = await LeaveRequest.create({
      employee,
      type: input.type,
      fromDate: input.fromDate,
      toDate: input.toDate,
      // Half a day only means something on a one-day request.
      halfDay: input.fromDate === input.toDate ? input.halfDay : undefined,
      days,
      leaveYear: year,
      reason: input.reason,
      contactNumber: input.contactNumber
    });

    return ok({ _id: created._id, days, status: created.status }, 201);
  } catch (error) {
    return fail(error);
  }
}
