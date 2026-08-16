import bcrypt from "bcryptjs";
import { z } from "zod";
import { cookies } from "next/headers";
import { connectDb } from "@/lib/db/mongoose";
import { User } from "@/models/User";
import { createSessionToken, SESSION_COOKIE } from "@/lib/auth/session";
import { landingFor, type Role } from "@/constants/access";
import { WORKSPACE_HOME } from "@/lib/workspace";
import { fail, ok } from "@/lib/api";

const schema = z.object({
  identifier: z.string().min(2),
  password: z.string().min(1),
  /**
   * Which door this sign-in came through.
   *
   * `super` is the one at `/super-admin`, and it refuses anybody who is not a
   * super administrator **before** the cookie is set rather than signing them in
   * and bouncing them afterwards. Not a security boundary — that account is
   * protected by its password and its role, and the same person can sign in
   * perfectly well at `/login` — but a door that quietly admits the wrong people
   * and then complains is a door that teaches everybody to ignore it.
   */
  scope: z.enum(["staff", "super"]).default("staff")
});

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

    /*
     * The password was right and this is still the wrong door. Said plainly,
     * because the alternative — the same "incorrect email or password" the line
     * above uses — would have somebody who *is* a super administrator, typing a
     * correct password, conclude their account was broken.
     *
     * No cookie has been set at this point, so nothing has to be undone.
     */
    if (input.scope === "super" && role !== "SUPERADMIN") {
      return Response.json({
        error: "That account is not a super administrator. Sign in at /login for the Doctor and Sales CRMs."
      }, { status: 403 });
    }

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

    // The super admin door lands on the panel it is the door to, rather than on
    // the chooser — somebody who typed that address has already chosen.
    return ok({
      name: user.name,
      role,
      redirectTo: input.scope === "super" ? WORKSPACE_HOME.control : landingFor(role)
    });
  } catch (error) {
    return fail(error);
  }
}
