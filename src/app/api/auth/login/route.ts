import bcrypt from "bcryptjs";
import { z } from "zod";
import { cookies } from "next/headers";
import { connectDb } from "@/lib/db/mongoose";
import { User } from "@/models/User";
import { createSessionToken, SESSION_COOKIE } from "@/lib/auth/session";
import { homeFor, type Role } from "@/constants/access";
import { fail, ok } from "@/lib/api";

const schema = z.object({ identifier: z.string().min(2), password: z.string().min(1) });

export async function POST(request: Request) {
  try {
    await connectDb();
    const input = schema.parse(await request.json());
    const identifier = input.identifier.trim();

    const user = await User.findOne({
      $or: [{ email: identifier.toLowerCase() }, { employeeId: identifier }],
      active: true
    }).select("+passwordHash");

    // One message for both cases, so the form never reveals which accounts exist.
    if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
      return Response.json({ error: "Incorrect email/ID or password" }, { status: 401 });
    }

    const role = user.role as Role;
    const token = await createSessionToken({ userId: String(user._id), name: user.name, role });
    (await cookies()).set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 12 * 60 * 60
    });

    user.lastLoginAt = new Date();
    await user.save();

    return ok({ name: user.name, role, redirectTo: homeFor(role) });
  } catch (error) {
    return fail(error);
  }
}
