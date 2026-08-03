import bcrypt from "bcryptjs";
import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { User } from "@/models/User";
import { Visit } from "@/models/Visit";
import { RoutePlan } from "@/models/RoutePlan";
import { Doctor } from "@/models/Doctor";
import { apiSession } from "@/lib/auth/guard";
import { can, ROLES } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";

const schema = z.object({
  name: z.string().min(2).optional(),
  role: z.enum(ROLES).optional(),
  active: z.boolean().optional(),
  newPassword: z.string().min(8, "Password must be at least 8 characters").optional()
});

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
    const update: Record<string, unknown> = {};
    if (value.name) update.name = value.name;
    if (value.role) update.role = value.role;
    if (value.active !== undefined) update.active = value.active;
    if (value.newPassword) update.passwordHash = await bcrypt.hash(value.newPassword, 12);

    const user = await User.findByIdAndUpdate(id, update, { new: true, runValidators: true })
      .select("name employeeId email role active");
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
