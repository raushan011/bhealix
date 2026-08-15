import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { SalesOrder } from "@/models/Sales";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { addressResolver, type OrderWithAddress } from "@/lib/sales/address";
import { addressOf, missingFields } from "@/lib/sales/fulfilment";
import { IntegrationError } from "@/lib/sales/http";
import { loadCredentials } from "@/lib/sales/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ orderId: z.string().regex(OBJECT_ID) });

/**
 * The delivery address for one order, fetched from the shop if this system
 * never kept one.
 *
 * The booking route does the same thing on its own behalf, so nothing depends
 * on this being called first. It exists so the dialog can show the operator the
 * real address *before* they commit to a courier — an address that appears only
 * in a failure message is an address nobody can correct.
 *
 * Always a 200 with whatever it could find, including nothing. "Shopify did not
 * answer" is not a reason to refuse a screen whose next control is a form for
 * typing the address in by hand.
 */
export async function POST(request: Request) {
  try {
    const auth = await apiSession(can.processOrders);
    if ("response" in auth) return auth.response;
    await connectDb();

    const { orderId } = schema.parse(await request.json());
    const order = await SalesOrder.findById(orderId) as OrderWithAddress | null;
    if (!order) return badRequest("No such order", 404);

    let fetched = false;
    let warning: string | undefined;

    if (missingFields(addressOf(order)).length) {
      const resolve = addressResolver(await loadCredentials());
      if (!resolve) {
        warning = "Shopify is not connected, so the rest of this address has to be typed in.";
      } else {
        try {
          fetched = Boolean(await resolve(order));
          if (!fetched) warning = "The shop has nothing more on file for this order — type in what is missing.";
        } catch (error) {
          warning = error instanceof IntegrationError ? error.message : "Could not read this order back from Shopify.";
        }
      }
    }

    const address = addressOf(order);
    return ok({ address, missing: missingFields(address), fetched, warning });
  } catch (error) {
    return fail(error);
  }
}
