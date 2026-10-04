import { apiSession } from "@/lib/auth/guard";
import { badRequest, fail, ok } from "@/lib/api";
import { lookupPincode } from "@/lib/pincode";

export const runtime = "nodejs";

/**
 * The city and state for a pin code, for any signed-in form that takes an
 * address. Answered from memory after the first time; the browser keeps it for
 * a day as well, since a pin code does not move.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ pin: string }> }) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    const { pin } = await params;
    if (!/^[1-9]\d{5}$/.test(pin)) return badRequest("Enter a 6-digit pin code");

    const place = await lookupPincode(pin);
    if (!place) return badRequest("No city or state is known for this pin code", 404);
    const response = ok(place);
    response.headers.set("cache-control", "private, max-age=86400");
    return response;
  } catch (error) {
    return fail(error);
  }
}
