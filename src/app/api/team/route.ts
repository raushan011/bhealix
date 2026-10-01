import bcrypt from "bcryptjs";
import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { User } from "@/models/User";
import { SalaryStructure } from "@/models/Payroll";
import { apiSession } from "@/lib/auth/guard";
import { ASSIGNABLE_ROLES, ROLES, can } from "@/constants/access";
import { badRequest, fail, ok } from "@/lib/api";
import { record } from "@/lib/audit";
import { employeeProfileShape, salaryInputSchema } from "@/lib/hr/employee-schema";
import { fullGrossOf } from "@/lib/hr/payroll";
import { componentsOf } from "@/lib/hr/payroll-run";

/**
 * Hiring somebody: their login, their employment record and, optionally, their
 * first salary — in one request, from one form.
 *
 * Everything but the login is optional, because a joiner is often added before
 * their bank details arrive; the rest is filled in on their profile afterwards.
 */
const createSchema = z.object({
  name: z.string().trim().min(2, "Full name is required"),
  employeeId: z.string().trim().min(2, "Employee ID is required"),
  email: z.email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  /** Never SUPERADMIN — see ASSIGNABLE_ROLES. That account is made from a shell. */
  role: z.enum(ASSIGNABLE_ROLES),
  ...employeeProfileShape,
  /** The first salary revision. Needs `runPayroll`, which the HR desk holds. */
  salary: salaryInputSchema.optional()
});

export async function GET(request: Request) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    await connectDb();

    const params = new URL(request.url).searchParams;
    const filter: Record<string, unknown> = {};
    if (params.get("active") !== "all") filter.active = true;
    if (params.get("field") === "1") filter.role = { $in: ["MR", "SALES"] };
    const role = params.get("role");
    if (role && (ROLES as readonly string[]).includes(role)) filter.role = role;

    const items = await User.find(filter)
      .select("name employeeId email role active lastLoginAt designation department joiningDate phone")
      .sort({ name: 1 }).limit(500).lean();
    return ok({ items });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await apiSession(can.manageEmployees);
    if ("response" in auth) return auth.response;
    await connectDb();

    const { password, employeeId, email, salary, reportingTo, ...value } = createSchema.parse(await request.json());

    // Choosing somebody's authority is the administrator's, as on the profile
    // screen: HR keeps records, and a role is authority over billing and stock.
    if (!can.assignRoles(auth.session.role) && ["ADMIN", "HR"].includes(value.role)) {
      return badRequest("Only an administrator can create an administrator or HR account", 403);
    }
    if (salary && !can.runPayroll(auth.session.role)) {
      return badRequest("You can add the employee, but setting a salary needs payroll access. Leave the salary blank.", 403);
    }
    if (salary && value.joiningDate && salary.effectiveFrom < value.joiningDate.slice(0, 7)) {
      return badRequest(`A salary cannot start before the joining month (${value.joiningDate.slice(0, 7)}).`);
    }

    // Two people signing in with the same email or employee ID would be the
    // same login, so say which one is taken rather than "a matching record".
    const taken = await User.findOne({ $or: [{ email: email.toLowerCase().trim() }, { employeeId: employeeId.trim() }] })
      .select("email employeeId name").lean() as { email: string; employeeId: string; name: string } | null;
    if (taken) {
      return badRequest(taken.email === email.toLowerCase().trim()
        ? `${taken.name} already signs in with ${taken.email}.`
        : `Employee ID ${taken.employeeId} already belongs to ${taken.name}.`, 409);
    }

    const blankless = Object.fromEntries(Object.entries(value).filter(([, field]) => field !== "" && field !== undefined));
    const user = await User.create({
      ...blankless,
      ...(reportingTo ? { reportingTo } : {}),
      employeeId: employeeId.trim(),
      email: email.toLowerCase().trim(),
      passwordHash: await bcrypt.hash(password, 12),
      employmentStatus: value.employmentStatus ?? "Probation",
      active: true
    });

    if (salary) {
      await SalaryStructure.create({ ...salary, employee: user._id, createdBy: auth.session.userId });
      await record({
        actor: auth.session.userId, action: "salary.revised", entityType: "User", entityId: user._id,
        metadata: { name: user.name, effectiveFrom: salary.effectiveFrom, monthlyGross: fullGrossOf(componentsOf(salary)), note: "Salary at joining" }
      });
    }

    return ok({ _id: user._id, name: user.name, role: user.role, salary: Boolean(salary) }, 201);
  } catch (error) {
    return fail(error);
  }
}
