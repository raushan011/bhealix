import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { SalesOrder } from "@/models/Sales";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { addressOf, normaliseParcel, parcelValueOf, paymentModeOf, type BookableOrder } from "@/lib/sales/fulfilment";
import { IntegrationError } from "@/lib/sales/http";
import { loadCredentials, shiprocketToken } from "@/lib/sales/settings";
import { pickupLocations, serviceability } from "@/lib/sales/shiprocket";

const schema = z.object({
  /** The order being quoted for — its pin code, its value and whether it is COD. */
  orderId: z.string().regex(OBJECT_ID),
  pickupLocation: z.string().trim().min(1),
  weight: z.number().positive().max(50),
  /** The operator may have typed a pin code the order never had. */
  pinCode: z.string().trim().regex(/^\d{6}$/).optional()
});

/**
 * Which couriers can carry this parcel, and for how much.
 *
 * Asked per order rather than once per batch because the answer is per pin code:
 * the courier that reaches Patna cheapest is not the one that reaches Kochi, and
 * a rate quoted for one address is not a rate for another. A batch does not call
 * this at all — it sends a rule instead, and the rule is applied to each order's
 * own list on the server (§ fulfilment `pickCourier`).
 */
export async function POST(request: Request) {
  try {
    const auth = await apiSession(can.processOrders);
    if ("response" in auth) return auth.response;
    await connectDb();

    const input = schema.parse(await request.json());
    const order = await SalesOrder.findById(input.orderId)
      .select("name customer items totals paymentMethod financialStatus shipment").lean() as BookableOrder | null;
    if (!order) return badRequest("No such order", 404);

    const settings = await loadCredentials();
    const token = await shiprocketToken(settings);
    if (!token) return badRequest("Shiprocket is not connected. Add the API user under Sales settings.", 502);

    const address = addressOf(order, input.pinCode ? { pinCode: input.pinCode } : null);
    const deliveryPincode = String(address.pinCode ?? "");
    if (!/^\d{6}$/.test(deliveryPincode)) return badRequest("This order has no 6-digit pin code on it yet.");

    try {
      const locations = await pickupLocations(token);
      const from = locations.find(location => location.name === input.pickupLocation) ?? locations[0];
      if (!from?.pinCode) return badRequest("That pickup address has no pin code on it in Shiprocket.", 502);

      const couriers = await serviceability(token, {
        pickupPincode: from.pinCode,
        deliveryPincode,
        weight: normaliseParcel({ weight: input.weight }).weight,
        cod: paymentModeOf(order) === "COD",
        declaredValue: parcelValueOf(order)
      });

      return ok({ couriers, from: from.name, cod: paymentModeOf(order) === "COD" });
    } catch (error) {
      if (error instanceof IntegrationError) return badRequest(error.message, 502);
      throw error;
    }
  } catch (error) {
    return fail(error);
  }
}
