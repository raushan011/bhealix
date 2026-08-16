import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok } from "@/lib/api";
import { record } from "@/lib/audit";
import { IntegrationError } from "@/lib/sales/http";
import { connectorFor } from "@/lib/finance/connectors";
import { loadCredentials, recordFetch } from "@/lib/finance/connections";
import { fileFetched } from "@/lib/finance/file-fetched";
import { isPeriod } from "@/lib/finance/period";
import { pullShiprocketOrderInvoices } from "@/lib/finance/pull";
import { sourceOf } from "@/lib/finance/sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Each Shiprocket batch is a render on their side and then a download. */
export const maxDuration = 300;

const schema = z.object({
  period: z.string().refine(isPeriod, "Choose the month to fetch"),
  source: z.string()
});

/**
 * Fetches a month of one vendor, with the API key stored for it.
 *
 * Dispatch is by the source's declared connector rather than by a switch over
 * vendor names, so a fifth vendor is a file in `lib/finance/connectors` and a
 * line in the registry. Shiprocket is the single exception and is called
 * directly: its fetch needs the `SalesOrder` records as well as the credentials,
 * which no other connector does and none of them should have to know about.
 *
 * Three refusals, each a different thing to fix and each said in those terms:
 * a source nothing can fetch, a source whose key has not been entered, and a
 * vendor that refused the key it was given.
 */
export async function POST(request: Request) {
  try {
    const auth = await apiSession(can.manageFinance);
    if ("response" in auth) return auth.response;
    await connectDb();

    const { period, source } = schema.parse(await request.json());
    const chosen = sourceOf(source);

    if (!chosen.connector) {
      return badRequest(
        `${chosen.vendor} does not publish its ${chosen.label.toLowerCase()} on any API this account can call. `
        + "Download it from their dashboard and file it here — the card links straight to the page."
      );
    }

    const connector = connectorFor(chosen.connector);
    const credentials = await loadCredentials(chosen.connector);
    if (!credentials) {
      return badRequest(`No API key is stored for ${connector.label}. Add it under Super admin → Connections.`);
    }

    try {
      /*
       * Shiprocket's own path. It reads the orders this application booked and
       * fetches the invoice Shiprocket rendered for each — the only one of the
       * four that comes back as the vendor's own document rather than as a
       * statement built from their figures.
       */
      if (chosen.connector === "shiprocket") {
        const outcome = await pullShiprocketOrderInvoices(period, auth.session.userId);
        await recordFetch("shiprocket");
        await record({
          actor: auth.session.userId, action: "finance.invoices.pulled",
          entityType: "VendorInvoice", entityId: period,
          metadata: { period, source, filed: outcome.filed, skipped: outcome.skipped }
        });
        return ok(outcome);
      }

      const result = await connector.fetch(credentials, period, auth.session.userId);
      const filed = await fileFetched(chosen.key, period, result.documents, auth.session.userId);
      await recordFetch(chosen.connector);

      await record({
        actor: auth.session.userId, action: "finance.invoices.pulled",
        entityType: "VendorInvoice", entityId: period,
        metadata: { period, source, filed, yields: chosen.yields }
      });

      return ok({
        source: chosen.key,
        filed,
        skipped: 0,
        message: result.message,
        /*
         * Carried back so the screen can go on asking for the PDF rather than
         * letting a successful fetch read as a finished month. A statement is
         * real data and is not the document credit is claimed against.
         */
        stillNeedsPdf: chosen.yields === "statement" ? chosen.stillNeedsPdf : undefined
      });
    } catch (error) {
      const message = error instanceof IntegrationError
        ? error.message
        : error instanceof Error ? error.message : "The fetch failed.";
      await recordFetch(chosen.connector, message);
      // The vendor's own words reach the screen: "Razorpay refused the request
      // (401)" is what gets somebody to check the key, and "Something went
      // wrong" is not.
      if (error instanceof IntegrationError) return badRequest(error.message, 502);
      throw error;
    }
  } catch (error) {
    return fail(error);
  }
}
