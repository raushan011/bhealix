import { connectDb } from "@/lib/db/mongoose";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok } from "@/lib/api";
import { IntegrationError } from "@/lib/sales/http";
import { loadCredentials, whatsappConfig } from "@/lib/sales/settings";
import { listTemplates } from "@/lib/sales/whatsapp";

/**
 * The templates on the WhatsApp Business Account, straight from Meta.
 *
 * Read live rather than cached: approval happens on Meta's side, usually within
 * the hour, and the person waiting for it is on this screen pressing refresh.
 */
export async function GET() {
  try {
    const auth = await apiSession(can.manageSales);
    if ("response" in auth) return auth.response;
    await connectDb();

    const config = whatsappConfig(await loadCredentials());
    if (!config) return badRequest("Connect WhatsApp first — the templates live on the business account.");

    try {
      const templates = await listTemplates(config);
      return ok({ templates });
    } catch (error) {
      if (error instanceof IntegrationError) return badRequest(error.message, 502);
      throw error;
    }
  } catch (error) {
    return fail(error);
  }
}
