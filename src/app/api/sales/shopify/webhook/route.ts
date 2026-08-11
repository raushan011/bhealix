import { connectDb } from "@/lib/db/mongoose";
import { fail } from "@/lib/api";
import { attributeOrder } from "@/lib/sales/coupons";
import { holdDaysOf, loadCredentials, rulesOf } from "@/lib/sales/settings";
import { codesOn, type ShopifyOrder } from "@/lib/sales/shopify";
import { couponIndex, saveShopifyOrder } from "@/lib/sales/sync";
import { verifyWebhook } from "@/lib/sales/webhooks";

/**
 * Shopify telling us about an order as it happens.
 *
 * **Public by necessity** — Shopify has no session with us — so the HMAC is the
 * whole of the authentication. It is signed over the raw bytes, which is why
 * the body is read as text and only then parsed: re-serialising the JSON
 * changes key order and whitespace, and the signature stops matching.
 *
 * Always answers 200 once the signature is good, even when the order is of no
 * interest. Shopify retries anything else for two days and then removes the
 * subscription — so "this order carried no affiliate coupon" must be reported
 * as success, because it *is* success. The only 401 is a bad signature.
 */
export async function POST(request: Request) {
  try {
    // Read once, as bytes. Everything below works from this string.
    const raw = await request.text();
    const topic = request.headers.get("x-shopify-topic") ?? "";
    const shop = request.headers.get("x-shopify-shop-domain") ?? "";

    await connectDb();
    const settings = await loadCredentials();

    if (!settings.shopifyClientSecret) {
      // Nothing to verify against. Refusing is right: accepting unverified
      // order data would let anybody write into the commission ledger.
      return new Response("not configured", { status: 401 });
    }

    if (!verifyWebhook(raw, request.headers.get("x-shopify-hmac-sha256"), settings.shopifyClientSecret)) {
      return new Response("bad signature", { status: 401 });
    }

    // Signed, but for a different shop than the one connected here.
    if (settings.shopifyDomain && shop && shop.toLowerCase() !== settings.shopifyDomain.toLowerCase()) {
      return new Response("wrong shop", { status: 200 });
    }

    const order = JSON.parse(raw) as ShopifyOrder;
    const coupons = await couponIndex();
    const match = attributeOrder(codesOn(order), new Map([...coupons].map(([code, value]) => [code, value.repId])));

    if (!match) return Response.json({ ok: true, attributed: false, topic });

    const outcome = await saveShopifyOrder(order, match, coupons, rulesOf(settings), holdDaysOf(settings));
    return Response.json({ ok: true, attributed: true, topic, outcome });
  } catch (error) {
    // A 500 has Shopify retry, which is what we want for a transient database
    // failure — the order is not lost, it arrives again in a few minutes.
    return fail(error);
  }
}

export const dynamic = "force-dynamic";
