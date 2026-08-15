import { connectDb } from "@/lib/db/mongoose";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { fail, ok } from "@/lib/api";
import { DEFAULT_PARCEL } from "@/lib/sales/constants";
import { normaliseParcel } from "@/lib/sales/fulfilment";
import { IntegrationError } from "@/lib/sales/http";
import { loadCredentials, shiprocketToken } from "@/lib/sales/settings";
import { pickupLocations } from "@/lib/sales/shiprocket";
import type { FulfilmentOptions } from "@/lib/sales/types";

/**
 * What the processing screen has to know before it can offer anything: which of
 * the company's addresses a parcel can leave from, and what the last one was
 * booked as.
 *
 * A missing or refused Shiprocket credential comes back as a 200 with a
 * `refusal` on it rather than an error. The screen still has orders to list and
 * filters to work; it simply cannot book anything, and saying so in a sentence
 * at the top is more use than a red box where the page should be.
 */
export async function GET() {
  try {
    const auth = await apiSession(can.processOrders);
    if ("response" in auth) return auth.response;
    await connectDb();

    const settings = await loadCredentials();
    const stored = (settings as { fulfilment?: {
      pickupLocation?: string; weight?: number; length?: number; breadth?: number; height?: number;
      courierRule?: FulfilmentOptions["defaults"]["courierRule"]; courierId?: number; courierName?: string;
    } }).fulfilment;

    const defaults: FulfilmentOptions["defaults"] = {
      pickupLocation: stored?.pickupLocation,
      parcel: normaliseParcel(stored ?? DEFAULT_PARCEL),
      courierRule: stored?.courierRule ?? "recommended",
      courierId: stored?.courierId,
      courierName: stored?.courierName
    };

    let token: string | null = null;
    try {
      token = await shiprocketToken(settings);
    } catch (error) {
      const message = error instanceof IntegrationError ? error.message : "Could not sign in to Shiprocket.";
      return ok({ pickupLocations: [], defaults, refusal: message } satisfies FulfilmentOptions);
    }

    if (!token) {
      return ok({
        pickupLocations: [], defaults,
        refusal: "Shiprocket is not connected. Add the API user's email and password under Sales settings before booking anything."
      } satisfies FulfilmentOptions);
    }

    try {
      const locations = await pickupLocations(token);
      return ok({
        pickupLocations: locations,
        // The address stored last time only stays the default while it still
        // exists on the account; a warehouse can be closed.
        defaults: locations.some(location => location.name === defaults.pickupLocation)
          ? defaults
          : { ...defaults, pickupLocation: locations[0]?.name },
        refusal: locations.length ? null : "This Shiprocket account has no pickup address on it. Add one under Settings → Pickup Addresses first."
      } satisfies FulfilmentOptions);
    } catch (error) {
      const message = error instanceof IntegrationError ? error.message : "Could not read the Shiprocket pickup addresses.";
      return ok({ pickupLocations: [], defaults, refusal: message } satisfies FulfilmentOptions);
    }
  } catch (error) {
    return fail(error);
  }
}
