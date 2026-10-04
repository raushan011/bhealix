import { connectDb } from "@/lib/db/mongoose";
import { SalesTeamOrder } from "@/models/SalesTeam";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { codAmountOf, parcelValueOf, paymentModeOf, type BookableOrder } from "@/lib/sales/fulfilment";
import { IntegrationError } from "@/lib/sales/http";
import { loadCredentials, shiprocketToken } from "@/lib/sales/settings";
import { pickupLocations, serviceability } from "@/lib/sales/shiprocket";
import { mayActOn, orderScope } from "@/lib/sales-team/access";
import { ratesSchema } from "@/lib/sales-team/schemas";
import { loadTeamSettings, parcelOfOrder } from "@/lib/sales-team/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What the booking dialog opens with: the company's pickup addresses, and the
 * parcel this order will be booked as — the administrator's carton at the
 * weight its products come to (`?orderId=`).
 *
 * A Shiprocket account that is not connected, or that refuses the credentials,
 * is a 200 with a `refusal` sentence rather than an error — the order screen
 * still works without it, and the sentence says who can fix it.
 */
export async function GET(request: Request) {
  try {
    const auth = await apiSession(can.placeSalesOrder);
    if ("response" in auth) return auth.response;
    await connectDb();

    const settings = await loadTeamSettings();
    const defaults = settings.fulfilment ?? {};
    const orderId = new URL(request.url).searchParams.get("orderId") ?? "";
    const order = OBJECT_ID.test(orderId)
      ? await SalesTeamOrder.findOne({ _id: orderId, ...(orderScope(auth.session) ?? {}) }).select("items").lean() as
        { items?: { catalogueId?: string; quantity?: number }[] } | null
      : null;
    const { parcel, units } = parcelOfOrder(order ?? { items: [{ quantity: 1 }] }, settings);
    const packaging = { ...settings.packaging, units };

    const token = await shiprocketToken(await loadCredentials()).catch(error => {
      if (error instanceof IntegrationError) return error;
      throw error;
    });
    if (!token) return ok({ locations: [], parcel, packaging, defaults, refusal: "Shiprocket is not connected yet. An administrator adds it under Affiliate CRM → Settings." });
    if (token instanceof IntegrationError) return ok({ locations: [], parcel, packaging, defaults, refusal: token.message });

    try {
      return ok({ locations: await pickupLocations(token), parcel, packaging, defaults });
    } catch (error) {
      if (error instanceof IntegrationError) return ok({ locations: [], parcel, packaging, defaults, refusal: error.message });
      throw error;
    }
  } catch (error) {
    return fail(error);
  }
}

/**
 * The couriers that reach this order's pin code from the chosen warehouse, with
 * their rates. Asked when the dialog opens and when the parcel or warehouse
 * changes — never on a keystroke.
 */
export async function POST(request: Request) {
  try {
    const auth = await apiSession(can.placeSalesOrder);
    if ("response" in auth) return auth.response;
    await connectDb();

    const input = ratesSchema.parse(await request.json());
    const order = await SalesTeamOrder.findOne({ _id: input.orderId, ...(orderScope(auth.session) ?? {}) }).lean() as
      (BookableOrder & { executive: unknown }) | null;
    if (!order) return badRequest("That order could not be found", 404);
    if (!mayActOn(auth.session, order.executive)) return badRequest("You do not have access to this action", 403);

    const token = await shiprocketToken(await loadCredentials());
    if (!token) return badRequest("Shiprocket is not connected.", 502);

    try {
      const from = (await pickupLocations(token)).find(location => location.name === input.pickupLocation);
      if (!from?.pinCode) return badRequest(`The pickup address "${input.pickupLocation}" has no pin code in Shiprocket.`, 502);

      const couriers = await serviceability(token, {
        pickupPincode: from.pinCode,
        deliveryPincode: String(order.customer?.pinCode ?? ""),
        weight: parcelOfOrder(order as { items?: { catalogueId?: string; quantity?: number }[] }, await loadTeamSettings()).parcel.weight,
        cod: paymentModeOf(order) === "COD",
        declaredValue: parcelValueOf(order)
      });
      return ok({ couriers: [...couriers].sort((left, right) => left.rate - right.rate), collect: codAmountOf(order) });
    } catch (error) {
      if (error instanceof IntegrationError) return badRequest(error.message, 502);
      throw error;
    }
  } catch (error) {
    return fail(error);
  }
}
