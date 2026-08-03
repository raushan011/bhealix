import bcrypt from "bcryptjs";
import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { User } from "@/models/User";
import { apiSession } from "@/lib/auth/guard";
import { can, ROLES } from "@/constants/access";
import { fail, ok } from "@/lib/api";

const createSchema = z.object({
  name: z.string().min(2, "Full name is required"),
  employeeId: z.string().min(2, "Employee ID is required"),
  email: z.email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role: z.enum(ROLES)
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

    const items = await User.find(filter).select("name employeeId email role active lastLoginAt").sort({ name: 1 }).limit(200).lean();
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

    const value = createSchema.parse(await request.json());
    const user = await User.create({
      name: value.name,
      employeeId: value.employeeId.trim(),
      email: value.email.toLowerCase().trim(),
      passwordHash: await bcrypt.hash(value.password, 12),
      role: value.role,
      active: true
    });
    return ok({ _id: user._id, name: user.name, role: user.role }, 201);
  } catch (error) {
    return fail(error);
  }
}
