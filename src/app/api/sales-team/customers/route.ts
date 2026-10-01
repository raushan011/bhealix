import { connectDb } from "@/lib/db/mongoose";
import { SalesTeamOrder } from "@/models/SalesTeam";
import { apiSession } from "@/lib/auth/guard";
import { badRequest, fail, ok } from "@/lib/api";
import { tenDigitPhone } from "@/lib/sales/fulfilment";
import { orderScope } from "@/lib/sales-team/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A repeat customer's last delivery address, found by phone.
 *
 * Typing a full address on a phone call is where most courier refusals start —
 * a missing landmark, a pin code with a digit swapped. A customer who has
 * ordered before has an address that has already been delivered to, so the form
 * offers it the moment ten digits are typed. Kept to the orders this person may
 * read: an executive finds their own customers, the desk anybody's.
 */
export async function GET(request: Request) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    const scope = orderScope(auth.session);
    if (!scope) return badRequest("You do not have access to the sales team's orders", 403);

    const phone = tenDigitPhone(new URL(request.url).searchParams.get("phone"));
    if (!phone) return ok({ customer: null });
    await connectDb();

    const last = await SalesTeamOrder.findOne({ ...scope, "customer.phone": { $regex: `${phone}$` } })
      .sort({ placedAt: -1 }).select("customer placedAt name delivery.state").lean() as
      { customer?: Record<string, string>; placedAt: Date; name: string; delivery?: { state?: string } } | null;
    const count = last ? await SalesTeamOrder.countDocuments({ ...scope, "customer.phone": { $regex: `${phone}$` } }) : 0;

    return ok({ customer: last?.customer ?? null, lastOrder: last ? { name: last.name, placedAt: last.placedAt, delivery: last.delivery?.state } : null, orders: count });
  } catch (error) {
    return fail(error);
  }
}
