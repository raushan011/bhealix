import { connectDb } from "@/lib/db/mongoose";
import { Product } from "@/models/Catalog";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok } from "@/lib/api";
import { IntegrationError } from "@/lib/sales/http";
import { loadTeamSettings, shopifyReadiness } from "@/lib/sales-team/server";
import { sellableVariants, type SellableVariant } from "@/lib/sales-team/shopify-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type SellableItem = { id: string; name: string; price: number; mrp?: number; sku?: string; stock?: number };

/**
 * A few minutes of the shop's catalogue, held in the server's memory.
 *
 * The form asks for it every time it opens, a dozen executives open it all day,
 * and the catalogue changes a few times a week. Stock read a few minutes stale
 * is fine for a hint; Shopify itself is what enforces it when the order lands.
 */
let cache: { at: number; items: SellableVariant[] } | null = null;
const CACHE_MS = 5 * 60_000;

/**
 * What can be sold, and at what price.
 *
 * When the sales team orders through Shopify, these are the shop's own products
 * and variants — so each line names a variant, and the order takes stock off the
 * shop. Otherwise the CRM's catalogue. Its own route rather than `/api/products`,
 * which belongs to the Doctor CRM and is closed to a sales executive.
 */
export async function GET(request: Request) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    if (!can.placeSalesOrder(auth.session.role) && !can.viewSalesTeam(auth.session.role)) {
      return badRequest("You do not have access to this action", 403);
    }
    await connectDb();

    const { orderChannel } = await loadTeamSettings();
    if (orderChannel === "Shopify") {
      const readiness = await shopifyReadiness();
      if (!readiness.config) return ok({ source: "Shopify", items: [], refusal: readiness.refusal });
      const fresh = new URL(request.url).searchParams.get("fresh") === "1";
      try {
        if (fresh || !cache || Date.now() - cache.at > CACHE_MS) cache = { at: Date.now(), items: await sellableVariants(readiness.config) };
      } catch (error) {
        if (error instanceof IntegrationError) return ok({ source: "Shopify", items: [], refusal: `Shopify would not list the products: ${error.message}` });
        throw error;
      }
      return ok({ source: "Shopify", items: cache.items satisfies SellableItem[] });
    }

    const products = await Product.find({ active: true }).select("name price mrp").sort({ name: 1 }).lean() as unknown as Array<{ _id: unknown; name: string; price?: number; mrp?: number }>;
    return ok({
      source: "Catalogue",
      items: products.map(product => ({ id: String(product._id), name: product.name, price: product.price || product.mrp || 0, mrp: product.mrp || undefined })) satisfies SellableItem[]
    });
  } catch (error) {
    return fail(error);
  }
}
