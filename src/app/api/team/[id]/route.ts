import bcrypt from "bcryptjs";
import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { User } from "@/models/User";
import { Visit } from "@/models/Visit";
import { RoutePlan } from "@/models/RoutePlan";
import { Doctor } from "@/models/Doctor";
import { SampleMovement } from "@/models/Sample";
import { LeaveRequest } from "@/models/HR";
import { apiSession } from "@/lib/auth/guard";
import { can, ROLES } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import type { LeaveType } from "@/lib/hr/leave";
import { leaveBalanceFor } from "@/lib/hr/records";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const text = (max = 200) => z.string().trim().max(max).optional();

const schema = z.object({
  name: z.string().min(2).optional(),
  role: z.enum(ROLES).optional(),
  active: z.boolean().optional(),
  newPassword: z.string().min(8, "Password must be at least 8 characters").optional(),

  // The employment record the HR desk keeps.
  designation: text(),
  department: text(),
  joiningDate: z.string().regex(ISO_DATE).optional().or(z.literal("")),
  reportingTo: z.string().regex(OBJECT_ID).nullable().optional(),
  employmentType: z.enum(["Full time", "Part time", "Contract", "Intern"]).optional(),
  workLocation: text(),
  phone: text(40),
  dateOfBirth: z.string().regex(ISO_DATE).optional().or(z.literal("")),
  bloodGroup: text(10),
  address: text(400),
  emergencyContact: z.object({
    name: text(120), relation: text(60), phone: text(40)
  }).optional(),
  panNumber: text(15),
  // Only the last four digits are ever stored — the whole number is not
  // something this application has any reason to hold.
  aadhaarLastFour: z.string().trim().regex(/^\d{4}$/, "Enter the last four digits").optional().or(z.literal("")),
  bankAccountNo: text(40),
  bankIfsc: text(20),
  /**
   * Spelled out rather than built from LEAVE_TYPES with `z.record`: a record
   * keyed by an enum demands every key, so sending only the types being changed
   * would be rejected. Unpaid is absent on purpose — it has no ceiling.
   */
  leaveEntitlement: z.object({
    Casual: z.number().min(0).max(365).optional(),
    Sick: z.number().min(0).max(365).optional(),
    Earned: z.number().min(0).max(365).optional(),
    Compensatory: z.number().min(0).max(365).optional()
  }).optional(),
  notes: text(1000)
});

/** Everything the HR profile screen reads. The password hash is never selected. */
const PROFILE_FIELDS =
  "name employeeId email role active lastLoginAt designation department joiningDate reportingTo employmentType "
  + "workLocation phone dateOfBirth bloodGroup address emergencyContact panNumber aadhaarLastFour bankAccountNo "
  + "bankIfsc leaveEntitlement notes createdAt";

/** One employee in full, with their leave position and recent field record. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Invalid employee reference");

    // The HR desk reads anybody's record; everybody else only their own.
    if (!can.manageEmployees(auth.session.role) && id !== auth.session.userId) {
      return badRequest("You do not have access to this record", 403);
    }

    await connectDb();
    const employee = await User.findById(id).select(PROFILE_FIELDS)
      .populate("reportingTo", "name employeeId").lean() as
      ({ _id: unknown; leaveEntitlement?: Partial<Record<LeaveType, number>> }) | null;
    if (!employee) return badRequest("Employee not found", 404);

    const [balances, leave, visits] = await Promise.all([
      leaveBalanceFor(id, employee.leaveEntitlement),
      LeaveRequest.find({ employee: id }).sort({ createdAt: -1 }).limit(10)
        .select("type fromDate toDate days status reason decidedAt").lean(),
      Visit.countDocuments({ employee: id, status: "Completed" })
    ]);

    return ok({ employee, balances, leave, completedVisits: visits });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.manageEmployees);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Invalid employee reference");

    const value = schema.parse(await request.json());
    // Losing the last administrator would lock everyone out of the panel.
    if (id === auth.session.userId && value.active === false) {
      return badRequest("You cannot deactivate your own account");
    }

    await connectDb();
    const { newPassword, reportingTo, ...profile } = value;
    const update: Record<string, unknown> = { ...profile };
    if (newPassword) update.passwordHash = await bcrypt.hash(newPassword, 12);
    // Null clears the reporting line; undefined leaves it alone.
    if (reportingTo !== undefined) update.reportingTo = reportingTo || null;
    // Somebody reporting to themselves would make the chain meaningless.
    if (reportingTo && reportingTo === id) return badRequest("An employee cannot report to themselves");

    const user = await User.findByIdAndUpdate(id, update, { new: true, runValidators: true })
      .select(PROFILE_FIELDS);
    return user ? ok(user) : badRequest("Employee not found", 404);
  } catch (error) {
    return fail(error);
  }
}

/**
 * Permanently removes an employee.
 *
 * Refused when they have completed visits: those are the record of work that
 * actually happened, and deleting the person would leave that history pointing
 * at nobody. Deactivating keeps the history and blocks sign-in.
 */
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await apiSession(can.manageEmployees);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Invalid employee reference");
    if (id === auth.session.userId) return badRequest("You cannot delete your own account");

    await connectDb();
    const user = await User.findById(id).select("name role");
    if (!user) return badRequest("Employee not found", 404);

    if (user.role === "ADMIN" && await User.countDocuments({ role: "ADMIN", active: true }) <= 1) {
      return badRequest("This is the last administrator — create another before deleting this one");
    }

    const completed = await Visit.countDocuments({ employee: id, status: { $in: ["Completed", "Missed"] } });
    if (completed) {
      return badRequest(`${user.name} has ${completed} recorded visit${completed === 1 ? "" : "s"}. Deactivate instead so that history is kept.`);
    }

    const movements = await SampleMovement.countDocuments({ employee: id });
    if (movements) {
      return badRequest(`${user.name} has sample stock on record. Deactivate instead so the stock history is kept.`);
    }

    // Nothing worth keeping is attached, so clear the scheduling links too.
    await Visit.deleteMany({ employee: id });
    await RoutePlan.updateMany({ assignedTo: id }, { $unset: { assignedTo: "" }, $set: { status: "Draft" } });
    await Doctor.updateMany({ assignedTo: id }, { $unset: { assignedTo: "" } });
    await User.findByIdAndDelete(id);

    return ok({ deleted: true, name: user.name });
  } catch (error) {
    return fail(error);
  }
}
