import bcrypt from "bcryptjs";
import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { User } from "@/models/User";
import { apiSession } from "@/lib/auth/guard";
import { badRequest, fail, ok } from "@/lib/api";

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "New password must be at least 8 characters")
});

export async function POST(request: Request) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    const value = schema.parse(await request.json());

    await connectDb();
    const user = await User.findById(auth.session.userId).select("+passwordHash");
    if (!user || !(await bcrypt.compare(value.currentPassword, user.passwordHash))) {
      return badRequest("Your current password is incorrect");
    }

    user.passwordHash = await bcrypt.hash(value.newPassword, 12);
    await user.save();
    return ok({ changed: true });
  } catch (error) {
    return fail(error);
  }
}
