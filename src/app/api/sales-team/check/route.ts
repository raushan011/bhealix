import { connectDb } from "@/lib/db/mongoose";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { fail, ok } from "@/lib/api";
import { preOrderCheck } from "@/lib/sales-team/checks";
import { checkSchema } from "@/lib/sales-team/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Before the order is placed: whether a courier delivers to the pin code (and
 * collects cash there), and how likely the parcel is to come back. Asked by the
 * order form when the pin code, phone or payment mode changes — never per
 * keystroke — so the executive can deal with it while the customer is still on
 * the line.
 */
export async function POST(request: Request) {
  try {
    const auth = await apiSession(can.placeSalesOrder);
    if ("response" in auth) return auth.response;
    await connectDb();
    return ok(await preOrderCheck(checkSchema.parse(await request.json())));
  } catch (error) {
    return fail(error);
  }
}
