import { connectDb } from "@/lib/db/mongoose";
import { apiSession } from "@/lib/auth/guard";
import { can, usesFieldPanel } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { stockByEmployee, stockFor } from "@/lib/samples/ledger";

/**
 * Stock on hand. With `?employee=` it answers for one rep — which is what the
 * visit form asks before a rep records what they handed over — and without it,
 * for the whole field team.
 */
export async function GET(request: Request) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    await connectDb();

    const requested = new URL(request.url).searchParams.get("employee") ?? "";
    // A rep always reads their own figures, whatever they ask for.
    const employee = usesFieldPanel(auth.session.role) ? auth.session.userId : requested;

    if (employee) {
      if (!OBJECT_ID.test(employee)) return badRequest("Invalid employee reference");
      if (!usesFieldPanel(auth.session.role) && !can.viewAllStock(auth.session.role)) {
        return badRequest("You do not have access to this action", 403);
      }
      return ok({ employee, rows: await stockFor(employee) });
    }

    if (!can.viewAllStock(auth.session.role)) return badRequest("You do not have access to this action", 403);
    return ok({ team: await stockByEmployee() });
  } catch (error) {
    return fail(error);
  }
}
