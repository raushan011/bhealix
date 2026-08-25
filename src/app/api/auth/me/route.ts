import { connectDb } from "@/lib/db/mongoose";
import { User } from "@/models/User";
import { apiSession } from "@/lib/auth/guard";
import { fail, ok } from "@/lib/api";

export async function GET() {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    await connectDb();
    const user = await User.findById(auth.session.userId).select("name email employeeId role lastLoginAt homeAddress homeLocation").lean();
    return user ? ok(user) : Response.json({ error: "Account not found" }, { status: 404 });
  } catch (error) {
    return fail(error);
  }
}
