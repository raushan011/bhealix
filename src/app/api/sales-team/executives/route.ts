import { connectDb } from "@/lib/db/mongoose";
import { User } from "@/models/User";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { fail, ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The sales executives, for a picker — whom to hand a lead to, whose order this
 * is. Their records are kept, and their logins created, under HR & Employees;
 * this only lists them.
 */
export async function GET(request: Request) {
  try {
    const auth = await apiSession(can.viewSalesTeam);
    if ("response" in auth) return auth.response;
    await connectDb();
    const all = new URL(request.url).searchParams.get("active") === "all";
    const items = await User.find({ role: "EXECUTIVE", ...(all ? {} : { active: true }) })
      .select("name employeeId email phone active designation joiningDate lastLoginAt").sort({ name: 1 }).lean();
    return ok({ items });
  } catch (error) {
    return fail(error);
  }
}
