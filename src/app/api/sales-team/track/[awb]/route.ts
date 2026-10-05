import { apiSession } from "@/lib/auth/guard";
import { badRequest, fail, ok } from "@/lib/api";
import { IntegrationError } from "@/lib/sales/http";
import { loadCredentials, shiprocketToken } from "@/lib/sales/settings";
import { trackByAwb } from "@/lib/sales/shiprocket";
import { orderScope } from "@/lib/sales-team/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where any parcel is, scan by scan, by its airway bill alone — for the orders
 * found in Shiprocket that this CRM never booked. A CRM order is tracked through
 * its own route instead, which also writes the answer back onto the order.
 */
export async function GET(_: Request, { params }: { params: Promise<{ awb: string }> }) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    if (!orderScope(auth.session)) return badRequest("You do not have access to the sales team's orders", 403);

    const awb = decodeURIComponent((await params).awb).trim();
    if (!/^[A-Za-z0-9-]{4,40}$/.test(awb)) return badRequest("That does not look like an airway bill number.");

    const token = await shiprocketToken(await loadCredentials());
    if (!token) return badRequest("Shiprocket is not connected.", 502);
    try {
      return ok({ tracking: await trackByAwb(token, awb) });
    } catch (error) {
      if (error instanceof IntegrationError) return badRequest(error.message, 502);
      throw error;
    }
  } catch (error) {
    return fail(error);
  }
}
