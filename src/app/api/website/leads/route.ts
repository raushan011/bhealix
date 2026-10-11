import { connectDb } from "@/lib/db/mongoose";
import { SalesLead } from "@/models/Sales";
import { badRequest, fail, ok } from "@/lib/api";
import { verifyCourierToken } from "@/lib/sales-team/courier-webhook";
import { CART_EVENTS_KEPT, WEBSITE_LEAD_TYPE, cartRemark, websiteLeadSchema } from "@/lib/sales-team/website-leads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A shopper on bhealix.com left their name and number at Add to cart.
 *
 * Posted by the "Bhealix Leads" Google Sheet's script, server to server, with
 * `WEBSITE_LEADS_TOKEN` in `x-api-key` — the storefront itself never holds the
 * token, because anything in a page's source is public. Public in the
 * middleware for the same reason as the courier webhook: the sheet has no
 * session with us, and the token is the check.
 *
 * One lead per phone number. A number already in the leads — a past website
 * shopper, or somebody an executive added by hand — gains the cart event and a
 * remark rather than a second row, so the executive who holds it sees the new
 * cart on the timeline they already work from. Status and assignment are left
 * alone: whoever holds the lead decides what a second cart means.
 */
export async function POST(request: Request) {
  if (!verifyCourierToken(request.headers.get("x-api-key"), process.env.WEBSITE_LEADS_TOKEN)) {
    return new Response("Unauthorised", { status: 401 });
  }

  try {
    let body: unknown;
    try { body = await request.json(); } catch { return badRequest("Send the lead as JSON."); }
    const input = websiteLeadSchema.parse(body);
    await connectDb();

    const at = new Date();
    const event = { at, product: input.product, variant: input.variant, qty: input.qty, page: input.page, source: input.source };
    const cartFields = { "cart.lastAt": at, "cart.lastProduct": input.product, "cart.lastSource": input.source };

    const existing = await SalesLead.findOne({ phone: { $regex: `${input.phone}$` } }).sort({ updatedAt: -1 }).select("_id").lean() as { _id: unknown } | null;
    if (existing) {
      await SalesLead.updateOne({ _id: existing._id }, {
        $set: cartFields,
        $inc: { "cart.count": 1 },
        $push: {
          "cart.events": { $each: [event], $slice: -CART_EVENTS_KEPT },
          remarks: { text: cartRemark(input, true), channel: "Note", at, byName: "Website" }
        }
      });
      return ok({ _id: existing._id, existed: true });
    }

    const lead = await SalesLead.create({
      name: input.name, phone: input.phone, type: WEBSITE_LEAD_TYPE, source: "Website", status: "New",
      cart: { lastAt: at, lastProduct: input.product, lastSource: input.source, count: 1, events: [event] },
      remarks: [{ text: cartRemark(input, false), channel: "Note", at, byName: "Website" }]
    });
    return ok({ _id: lead._id, existed: false }, 201);
  } catch (error) {
    return fail(error);
  }
}
