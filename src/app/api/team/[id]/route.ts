import bcrypt from "bcryptjs";
import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { User } from "@/models/User";
import { Visit } from "@/models/Visit";
import { RoutePlan } from "@/models/RoutePlan";
import { Doctor } from "@/models/Doctor";
import { SampleMovement } from "@/models/Sample";
import { LeaveRequest } from "@/models/HR";
import { Payslip, SalaryStructure } from "@/models/Payroll";
import { apiSession } from "@/lib/auth/guard";
import { ASSIGNABLE_ROLES, can, mayEditAccount, type Role } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import type { LeaveType } from "@/lib/hr/leave";
import { leaveBalanceFor } from "@/lib/hr/records";
import { EMPLOYMENT_STATUSES } from "@/lib/hr/payroll";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const text = (max = 200) => z.string().trim().max(max).optional();

const schema = z.object({
  name: z.string().min(2).optional(),
  /**
   * Never SUPERADMIN. Promoting somebody is not an employment-record change —
   * it is handing over the account that decides everybody else's access, and
   * `manageEmployees` is held by HR as well as the administrator. It is done
   * from a shell (`scripts/make-super-admin.mjs`) and nowhere else.
   */
  role: z.enum(ASSIGNABLE_ROLES).optional(),
  active: z.boolean().optional(),
  newPassword: z.string().min(8, "Password must be at least 8 characters").optional(),

  // The employment record the HR desk keeps.
  designation: text(),
  department: text(),
  joiningDate: z.string().regex(ISO_DATE).optional().or(z.literal("")),
  reportingTo: z.string().regex(OBJECT_ID).nullable().optional(),
  employmentType: z.enum(["Full time", "Part time", "Contract", "Intern"]).optional(),
  workLocation: text(),
  employmentStatus: z.enum(EMPLOYMENT_STATUSES).optional(),
  confirmationDate: z.string().regex(ISO_DATE).optional().or(z.literal("")),
  /** The last working day. Payroll pays up to it and no further. */
  exitDate: z.string().regex(ISO_DATE).optional().or(z.literal("")),
  exitReason: text(300),
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
  bankName: text(80),
  /** The provident fund number that follows a person between employers. */
  uan: text(20),
  esicNumber: text(20),
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
  + "workLocation employmentStatus confirmationDate exitDate exitReason phone dateOfBirth bloodGroup address "
  + "emergencyContact panNumber aadhaarLastFour bankAccountNo bankIfsc bankName uan esicNumber "
  + "leaveEntitlement notes createdAt";

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
    if (id === auth.session.userId && value.active === false) {
      return badRequest("You cannot deactivate your own account");
    }

    await connectDb();
    const target = await User.findById(id).select("role active name").lean() as
      { role: Role; active: boolean; name: string } | null;
    if (!target) return badRequest("Employee not found", 404);

    /*
     * A super administrator's record is closed to everybody below them.
     *
     * Not merely their role — the whole record, because this route also sets
     * passwords and `active`. An administrator who could set that password
     * could sign in as them; one who could deactivate them could remove the
     * only account able to restore anybody's access, and there would be no way
     * back through the interface. Refused as a whole rather than field by
     * field, which is the kind of list somebody eventually adds a field to
     * without noticing.
     */
    if (!mayEditAccount(auth.session.role, target.role)) {
      return badRequest(`${target.name} is a super administrator. Their account is changed from a shell, not from here.`, 403);
    }

    /*
     * Who somebody is, is the administrator's to decide.
     *
     * HR keeps the employment record — designation, leave, contact details —
     * but granting a role is granting authority over billing, the doctor
     * directory and inventory. Left to `manageEmployees` alone, an HR user
     * could set their own row to Administrator and take all of it.
     */
    if (value.role !== undefined && value.role !== target.role && auth.session.role !== "ADMIN") {
      return badRequest("Only an administrator can change somebody's role", 403);
    }

    /*
     * The last administrator cannot be removed from the panel by any route.
     * Deleting one is already refused; deactivating or demoting one was not,
     * and would leave nobody able to bill, plan or move stock — with no way
     * back, because restoring the role needs an administrator.
     */
    const losingLastAdmin = target.role === "ADMIN" && target.active
      && (value.active === false || (value.role !== undefined && value.role !== "ADMIN"));
    if (losingLastAdmin && await User.countDocuments({ role: "ADMIN", active: true }) <= 1) {
      return badRequest(`${target.name} is the last active administrator. Appoint another one first.`);
    }
    /*
     * A leaving date is what payroll pays up to, so a nonsensical one would pay
     * somebody for a month they had not started, or for none at all.
     */
    if (value.exitDate) {
      const joining = value.joiningDate ?? (await User.findById(id).select("joiningDate").lean() as
        { joiningDate?: string } | null)?.joiningDate;
      if (joining && value.exitDate < joining) {
        return badRequest("A leaving date cannot come before the joining date");
      }
    }

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

    // Closed for the same reason a super administrator cannot be edited above:
    // deleting one removes the only account that can restore anybody's access.
    if (!mayEditAccount(auth.session.role, user.role as Role)) {
      return badRequest(`${user.name} is a super administrator and cannot be deleted from here.`, 403);
    }

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

    /*
     * A payslip is evidence of money paid to a person, and the payroll month it
     * belongs to has been totalled and approved around it. Deleting the person
     * would leave the month's figures describing somebody who is not there.
     * Somebody who has left is recorded with a leaving date, not erased.
     */
    const paid = await Payslip.countDocuments({ employee: id });
    if (paid) {
      return badRequest(
        `${user.name} has ${paid} payslip${paid === 1 ? "" : "s"} on record. Set their last working day and deactivate `
        + "the account instead, so the payroll history stays whole."
      );
    }

    // Nothing worth keeping is attached, so clear the scheduling links too.
    await Visit.deleteMany({ employee: id });
    await SalaryStructure.deleteMany({ employee: id });
    await RoutePlan.updateMany({ assignedTo: id }, { $unset: { assignedTo: "" }, $set: { status: "Draft" } });
    await Doctor.updateMany({ assignedTo: id }, { $unset: { assignedTo: "" } });
    await User.findByIdAndDelete(id);

    return ok({ deleted: true, name: user.name });
  } catch (error) {
    return fail(error);
  }
}
