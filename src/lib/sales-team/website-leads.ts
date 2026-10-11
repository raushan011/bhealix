import { z } from "zod";
import { tenDigitPhone } from "@/lib/sales/fulfilment";

/**
 * Shoppers who left their number at Add to cart on bhealix.com.
 *
 * The storefront asks for a name and mobile number before the first Add to cart
 * and posts them to the "Bhealix Leads" Google Sheet; the sheet's script forwards
 * each one here (`POST /api/website/leads`). Each becomes a `SalesLead` with
 * source `Website`, so the desk hands it out from Website carts and the
 * executive works it from My leads with the same remarks, follow-ups and
 * statuses as any other lead — not a second list nobody remembers to check.
 *
 * Pure (§4.1): the route and the screens share the type label and the parsing.
 */

/** The `type` every website lead is filed under — what the Website carts screen filters on. */
export const WEBSITE_LEAD_TYPE = "Website cart";

/** Cart events kept per lead. A shopper who carts fifty times is still one call. */
export const CART_EVENTS_KEPT = 20;

const text = (max: number) => z.preprocess(value => value == null ? undefined : String(value), z.string().trim().max(max).optional());

/**
 * What the sheet's script sends — exactly what the storefront collected.
 *
 * Lenient on everything but the phone: a product name the theme could not read,
 * or a page URL longer than expected, must not cost the company the number.
 */
export const websiteLeadSchema = z.object({
  name: z.preprocess(value => String(value ?? "").trim().slice(0, 80), z.string().min(1, "name is required")),
  phone: z.preprocess(value => tenDigitPhone(String(value ?? "")), z.string().regex(/^[6-9]\d{9}$/, "phone must be an Indian mobile number")),
  product: text(200),
  variant: text(40),
  qty: z.preprocess(value => Math.min(99, Math.max(1, Math.round(Number(value) || 1))), z.number()),
  page: text(500),
  source: text(200)
});
export type WebsiteLeadInput = z.infer<typeof websiteLeadSchema>;

/** One Add to cart as stored on the lead (`SalesLead.cart.events[]`). */
export type CartEvent = { at: string | Date; product?: string; variant?: string; qty?: number; page?: string; source?: string };

/** The one line a list shows for a website lead: what, how many times, from where. */
export function cartSummary(cart: { lastProduct?: string; count?: number; lastSource?: string } | undefined): string {
  if (!cart) return "";
  return [
    cart.lastProduct || "Add to cart",
    cart.count && cart.count > 1 ? `${cart.count} adds` : "",
    cart.lastSource && cart.lastSource !== "direct" ? `via ${cart.lastSource}` : ""
  ].filter(Boolean).join(" · ");
}

/** The remark written onto the lead's timeline for each Add to cart, so the executive reads it before dialling. */
export function cartRemark(input: Pick<WebsiteLeadInput, "product" | "qty" | "source">, again: boolean): string {
  const what = `${input.product || "a product"}${input.qty > 1 ? ` × ${input.qty}` : ""}`;
  const via = input.source && input.source !== "direct" ? ` (via ${input.source})` : "";
  return `${again ? "Added to cart again" : "Added to cart"} on the website: ${what}${via}.`;
}

/** One `$group` row of the tracking aggregation: an executive (or nobody) and a status. */
export type ExecutiveCount = { _id: { executive?: unknown; status?: string }; count: number; user?: Array<{ name?: string }> };

/** One row of the desk's tracking table: who holds website leads, and where each stands. */
export type ExecutiveRow = { executive: string | null; name: string; total: number; counts: Record<string, number> };

/**
 * Folds `{executive, status} → count` into one row per executive, busiest first,
 * with the leads nobody holds as the first row so the backlog is never below the fold.
 */
export function executiveRows(rows: ExecutiveCount[]): ExecutiveRow[] {
  const byKey = new Map<string, ExecutiveRow>();
  for (const row of rows) {
    const id = row._id.executive ? String(row._id.executive) : null;
    const key = id ?? "none";
    const entry = byKey.get(key) ?? { executive: id, name: id ? row.user?.[0]?.name ?? "Former employee" : "Not assigned", total: 0, counts: {} };
    const status = row._id.status ?? "New";
    entry.counts[status] = (entry.counts[status] ?? 0) + row.count;
    entry.total += row.count;
    byKey.set(key, entry);
  }
  return [...byKey.values()].sort((left, right) => (left.executive === null ? -1 : right.executive === null ? 1 : right.total - left.total || left.name.localeCompare(right.name)));
}
