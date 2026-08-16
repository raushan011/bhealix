import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok } from "@/lib/api";
import { record } from "@/lib/audit";
import { IntegrationError } from "@/lib/sales/http";
import { isPeriod } from "@/lib/finance/period";
import { pullShiprocketOrderInvoices } from "@/lib/finance/pull";
import { sourceOf } from "@/lib/finance/sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Each batch of thirty is a render on Shiprocket's side and then a download. */
export const maxDuration = 300;

const schema = z.object({
  period: z.string().refine(isPeriod, "Choose the month to pull"),
  source: z.string()
});

/**
 * Fetches what can be fetched.
 *
 * One source qualifies today — Shiprocket's order tax invoices — and the route
 * refuses the rest by name rather than pretending to try. That refusal is the
 * important part: a "sync" that ran against Razorpay or Meta and filed nothing
 * would leave a month looking synced and empty, which is indistinguishable on
 * screen from a month that genuinely had no bills. Being told "Razorpay does not
 * publish this on an API — here is the page to download it from" is a smaller
 * feature and a much more useful one.
 */
export async function POST(request: Request) {
  try {
    const auth = await apiSession(can.manageFinance);
    if ("response" in auth) return auth.response;
    await connectDb();

    const { period, source } = schema.parse(await request.json());
    const chosen = sourceOf(source);

    if (chosen.collection !== "pull") {
      return badRequest(
        `${chosen.vendor} does not publish its ${chosen.label.toLowerCase()} on an API this account can call. Download it from their dashboard and file it here — the upload box beside this source links straight to the page.`
      );
    }

    try {
      const outcome = await pullShiprocketOrderInvoices(period, auth.session.userId);

      await record({
        actor: auth.session.userId,
        action: "finance.invoices.pulled",
        entityType: "VendorInvoice",
        entityId: period,
        metadata: { period, source, filed: outcome.filed, skipped: outcome.skipped }
      });

      return ok(outcome);
    } catch (error) {
      // The supplier's own words reach the screen: "Shiprocket refused the
      // request (401)" is what gets somebody to check the API user, and
      // "Something went wrong" is not.
      if (error instanceof IntegrationError) return badRequest(error.message, 502);
      throw error;
    }
  } catch (error) {
    return fail(error);
  }
}
