import { connectDb } from "@/lib/db/mongoose";
import { SalesTeamOrder } from "@/models/SalesTeam";
import { apiSession } from "@/lib/auth/guard";
import { badRequest, fail, ok } from "@/lib/api";
import { IntegrationError } from "@/lib/sales/http";
import { like } from "@/lib/sales/leads";
import { loadCredentials, shiprocketToken } from "@/lib/sales/settings";
import { searchShiprocketOrders, type ShiprocketSearchResult } from "@/lib/sales/shiprocket";
import { isExecutive, orderScope } from "@/lib/sales-team/access";
import { dayRange } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** A name search reads up to a year of Shiprocket orders on its first run; after that it is remembered. */
export const maxDuration = 60;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const CRM_FIELDS = "name ref placedAt executiveName customer.name customer.phone customer.city customer.pinCode totals.paid paymentMode "
  + "cancelledAt shipment.awb shipment.courier shipment.status delivery.state";

/**
 * The order tracker: find any order by the customer's name, their phone, the
 * order number or the airway bill, within a date range — and then follow it.
 *
 * Two places are searched at once, because the company's orders live in two:
 *
 * - **This CRM's sales orders** — an executive sees their own, the desk sees all.
 * - **Shiprocket itself**, which holds every parcel the account ever shipped,
 *   including the years of shop orders from before this CRM booked anything.
 *   Those exist nowhere else, and "where is my parcel from March" is a call the
 *   team takes.
 *
 * An executive must type something to search Shiprocket — a name, a number, an
 * AWB. The desk may also browse it by date alone. Shiprocket holds every
 * customer the company has ever had, and an executive's job is the call in
 * front of them, not reading the whole book.
 */
export async function GET(request: Request) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    const scope = orderScope(auth.session);
    if (!scope) return badRequest("You do not have access to the sales team's orders", 403);

    const params = new URL(request.url).searchParams;
    const raw = (params.get("q") ?? "").trim().slice(0, 80);
    const from = ISO_DAY.test(params.get("from") ?? "") ? params.get("from")! : "";
    const to = ISO_DAY.test(params.get("to") ?? "") ? params.get("to")! : "";
    const page = Math.max(1, Math.min(500, Number(params.get("page")) || 1));

    // A phone typed as "+91 98765-43210" is searched as the ten digits it is stored as.
    const digits = raw.replace(/\D/g, "");
    const phoneLike = /^[+\d\s()-]+$/.test(raw) && digits.length >= 10 && digits.length <= 12;
    const q = phoneLike ? digits.slice(-10) : raw;

    await connectDb();

    // ---------------------------------------------------------------- the CRM
    const and: Record<string, unknown>[] = [scope];
    const placed = dayRange(from, to);
    if (placed) and.push({ placedAt: placed });
    if (q) {
      const pattern = like(q);
      and.push({ $or: [{ name: pattern }, { ref: pattern }, { "customer.name": pattern }, { "customer.phone": pattern }, { "shipment.awb": pattern }] });
    }
    const crm = page === 1
      ? await SalesTeamOrder.find({ $and: and }).select(CRM_FIELDS).sort({ placedAt: -1 }).limit(50).lean()
      : [];

    // ---------------------------------------------------------- Shiprocket
    const executive = isExecutive(auth.session);
    let shiprocket: ShiprocketSearchResult | null = null;
    let refusal: string | undefined;

    if (executive && q.length < 3) {
      refusal = "Type a name, phone number, order number or AWB to search older Shiprocket orders as well.";
    } else {
      try {
        const token = await shiprocketToken(await loadCredentials());
        if (!token) refusal = "Shiprocket is not connected, so only this CRM's orders were searched.";
        else shiprocket = await searchShiprocketOrders(token, { search: q || undefined, from: from || undefined, to: to || undefined, page });
      } catch (error) {
        if (!(error instanceof IntegrationError)) throw error;
        refusal = `Shiprocket could not be searched: ${error.message}`;
      }
    }

    // A Shiprocket row that is also a CRM order on screen links to it instead of repeating it.
    const known = new Map<string, string>();
    for (const order of crm as unknown as { _id: unknown; name?: string; shipment?: { awb?: string } }[]) {
      if (order.name) known.set(`name:${order.name.replace(/^#/, "")}`, String(order._id));
      if (order.shipment?.awb) known.set(`awb:${order.shipment.awb}`, String(order._id));
    }
    const shiprocketItems = (shiprocket?.items ?? []).map(row => ({
      ...row,
      crmId: known.get(`awb:${row.awb ?? ""}`) ?? known.get(`name:${row.channelOrderId.replace(/^#/, "")}`)
    }));

    // Something that looks like an airway bill can be tracked directly, whatever the lists found.
    const awbLike = /^[A-Za-z0-9-]{8,25}$/.test(raw) && /\d{6,}/.test(raw) && !phoneLike;

    return ok({
      crm,
      shiprocket: { items: shiprocketItems, total: shiprocket?.total ?? 0, pages: shiprocket?.pages ?? 0, page, note: shiprocket?.note },
      refusal,
      trackAwb: awbLike ? raw : undefined
    });
  } catch (error) {
    return fail(error);
  }
}
