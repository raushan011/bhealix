import bcrypt from "bcryptjs";
import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { User } from "@/models/User";
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
