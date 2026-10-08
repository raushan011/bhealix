import { Types } from "mongoose";
import { connectDb } from "@/lib/db/mongoose";
import { SalesTeamOrder } from "@/models/SalesTeam";
import { SalesCoupon, SalesLead } from "@/models/Sales";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID, pageParams } from "@/lib/api";
import { record } from "@/lib/audit";
import { like } from "@/lib/sales/leads";
import { DELIVERY_STATES } from "@/lib/sales/constants";
import { dayRange, shiftDay, todayIso } from "@/lib/time";
import { isExecutive, orderScope } from "@/lib/sales-team/access";
import {
  collectAmountOf, formatRupees, INCENTIVE_STATUSES, PAYMENT_MODE_LABEL, paymentProblem, ruleFor,
  TEAM_PAYMENT_MODES, type TeamPaymentMode
} from "@/lib/sales-team/orders";
import { orderInputSchema } from "@/lib/sales-team/schemas";
import { preOrderCheck } from "@/lib/sales-team/checks";
import { activeExecutive, applyRule, loadTeamSettings, nextTeamOrderNo, priceTeamOrder, recalculateIncentive, shopifyReadiness } from "@/lib/sales-team/server";
import { cancelShopifyOrder, placeShopifyOrder, type PlacedOrder } from "@/lib/sales-team/shopify-api";
import { buildShopifyOrder, TEAM_DISCOUNT_CODE } from "@/lib/sales-team/shopify-order";
import { IntegrationError } from "@/lib/sales/http";
import type { ShopifyConfig } from "@/lib/sales/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIST_FIELDS = "name ref channel origin shopifyOrderId placedAt executive executiveName lead customer.name customer.phone customer.city customer.pinCode "
  + "totals paymentMode advancePaid collectAmount cancelledAt shipment.awb shipment.courier shipment.shiprocketOrderId "
  + "shipment.status shipment.lastError shipment.pickupScheduledAt delivery.state incentive.amount incentive.status "
  + "incentive.needsReversal items.title items.quantity rtoRisk.level shipment.expectedDelivery";

/**
 * The sales team's orders — an executive's own, or everybody's for the desk.
 *
 * `summary` covers the whole filtered set rather than the page, so the figures
 * above the list say what the filter found, not what happens to be on screen.
 */
export async function GET(request: Request) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    const scope = orderScope(auth.session);
    if (!scope) return badRequest("You do not have access to the sales team's orders", 403);
    await connectDb();

    const { page, limit, skip, q } = pageParams(request.url);
    const params = new URL(request.url).searchParams;
    const and: Record<string, unknown>[] = [scope];

    const executive = params.get("executive");
    if (executive && OBJECT_ID.test(executive) && !isExecutive(auth.session)) and.push({ executive: new Types.ObjectId(executive) });
    if (executive === "none" && !isExecutive(auth.session)) and.push({ executive: null });
    // Placed through this CRM, or brought in from the shop or the courier account.
    const source = params.get("source");
    if (source === "CRM") and.push({ origin: { $nin: ["Shopify", "Shiprocket"] } });
    if (source === "Shopify" || source === "Shiprocket") and.push({ origin: source });
    const mode = params.get("mode");
    if (mode && (TEAM_PAYMENT_MODES as readonly string[]).includes(mode)) and.push({ paymentMode: mode });
    const delivery = params.get("delivery");
    if (delivery && (DELIVERY_STATES as readonly string[]).includes(delivery)) and.push({ "delivery.state": delivery });
    const incentive = params.get("incentive");
    if (incentive && (INCENTIVE_STATUSES as readonly string[]).includes(incentive)) and.push({ "incentive.status": incentive });
    const lead = params.get("lead");
    if (lead && OBJECT_ID.test(lead)) and.push({ lead: new Types.ObjectId(lead) });

    switch (params.get("status")) {
      case "unbooked": and.push({ cancelledAt: null, "shipment.awb": { $in: [null, ""] } }); break;
      case "booked": and.push({ cancelledAt: null, "shipment.awb": { $nin: [null, ""] } }); break;
      case "failed": and.push({ cancelledAt: null, "shipment.lastError": { $nin: [null, ""] } }); break;
      case "cancelled": and.push({ cancelledAt: { $ne: null } }); break;
    }

    // Parcels to ring the customer about: arriving today (or out for delivery), or tomorrow.
    const due = params.get("due");
    if (due === "today" || due === "tomorrow") {
      const day = due === "today" ? todayIso() : shiftDay(todayIso(), 1);
      const open = { cancelledAt: null, "delivery.state": { $in: ["Awaiting", "In transit", "Undelivered"] } };
      and.push(due === "today"
        ? { ...open, $or: [{ "shipment.expectedDelivery": day }, { "shipment.status": /out[\s_-]*for[\s_-]*delivery/i }] }
        : { ...open, "shipment.expectedDelivery": day });
    }

    const placed = dayRange(params.get("from"), params.get("to"));
    if (placed) and.push({ placedAt: placed });

    if (q) {
      const pattern = like(q);
      and.push({ $or: [{ name: pattern }, { ref: pattern }, { "customer.name": pattern }, { "customer.phone": pattern }, { "customer.city": pattern }, { "shipment.awb": pattern }] });
    }

    const filter = { $and: and };
    const [items, total, totals] = await Promise.all([
      SalesTeamOrder.find(filter).select(LIST_FIELDS).sort({ placedAt: -1 }).skip(skip).limit(limit).lean(),
      SalesTeamOrder.countDocuments(filter),
      SalesTeamOrder.aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            orders: { $sum: 1 },
            value: { $sum: { $cond: [{ $ifNull: ["$cancelledAt", false] }, 0, "$totals.paid"] } },
            delivered: { $sum: { $cond: [{ $eq: ["$delivery.state", "Delivered"] }, 1, 0] } },
            pending: { $sum: { $cond: [{ $eq: ["$incentive.status", "Pending"] }, "$incentive.amount", 0] } },
            payable: { $sum: { $cond: [{ $eq: ["$incentive.status", "Payable"] }, "$incentive.amount", 0] } },
            paid: { $sum: { $cond: [{ $eq: ["$incentive.status", "Paid"] }, "$incentive.amount", 0] } }
          }
        }
      ])
    ]);

    const summary = totals[0] ?? { orders: 0, value: 0, delivered: 0, pending: 0, payable: 0, paid: 0 };
    return ok({ items, total, page, pages: Math.max(1, Math.ceil(total / limit)), summary });
  } catch (error) {
    return fail(error);
  }
}

/**
 * Places an order.
 *
 * An executive's order is always their own; an administrator names whose it is.
 * Every figure is worked out here from the lines (§4.2), and the incentive rule
 * for the payment mode is frozen onto the order now — what the executive was
 * promised when they closed the sale is what they are paid.
 *
 * Placing an order books nothing with the courier. That is a second, deliberate
 * step: the address is checked, the parcel weighed and a courier chosen, and a
 * mistake caught before booking costs nothing while one caught after costs a
 * freight.
 */
export async function POST(request: Request) {
  try {
    const auth = await apiSession(can.placeSalesOrder);
    if ("response" in auth) return auth.response;
    await connectDb();

    const input = orderInputSchema.parse(await request.json());
    const executiveId = isExecutive(auth.session) ? auth.session.userId : input.executive;
    if (!executiveId) return badRequest("Choose the sales executive this order belongs to.");

    const executive = await activeExecutive(executiveId);
    if (!executive) return badRequest("That person is not an active sales executive. Add them under HR & Employees with the Sales executive role.");

    const mode = input.paymentMode as TeamPaymentMode;
    const settingsForPrice = await loadTeamSettings();
    const { quote: handbook, priced, lines: pricedLines } = priceTeamOrder(settingsForPrice, { ...input, paymentMode: mode });
    if (!pricedLines.some(line => line.mrp > 0)) return badRequest("Add at least one product from the catalogue.");
    const advance = mode === "Prepaid" ? priced.total : mode === "COD" ? 0 : input.advancePaid;
    const problem = paymentProblem(mode, priced.total, advance);
    if (problem) return badRequest(problem);

    type LeadRef = { _id: Types.ObjectId; name: string; assignedTo?: Types.ObjectId };
    let lead: LeadRef | null = null;
    if (input.lead) {
      lead = await SalesLead.findById(input.lead).select("name assignedTo").lean() as LeadRef | null;
      if (!lead) return badRequest("That lead is no longer in the list.", 404);
      // An executive converts the leads handed to them, not a colleague's.
      if (isExecutive(auth.session) && String(lead.assignedTo ?? "") !== auth.session.userId) {
        return badRequest("That lead is assigned to somebody else.", 403);
      }
    }

    const settings = settingsForPrice;
    const ref = await nextTeamOrderNo();
    const channel = settings.orderChannel;

    /*
     * Placed in the shop first, and only then written down here.
     *
     * The other order would leave a CRM order claiming a sale the shop never
     * heard of: no stock taken, nothing for Shiprocket's channel to pick up.
     * This way round, a refusal from Shopify stops the whole thing in its own
     * words, and the order exists in both places or neither.
     */
    let placed: PlacedOrder | null = null;
    let shop: ShopifyConfig | null = null;
    if (channel === "Shopify") {
      const readiness = await shopifyReadiness();
      if (!readiness.config) return badRequest(readiness.refusal ?? "Shopify is not ready to take orders.", 502);
      shop = readiness.config;
      try {
        placed = await placeShopifyOrder(shop, buildShopifyOrder({
          ref,
          executive: { name: executive.name, employeeId: executive.employeeId },
          customer: { ...input.customer, email: input.customer.email || undefined, address2: input.customer.address2 || undefined, country: input.customer.country || "India" },
          lines: priced.lines,
          discount: priced.discount,
          total: priced.total,
          paymentMode: mode,
          advance,
          paymentReference: input.paymentReference || undefined,
          notes: input.notes || undefined
        }));
      } catch (error) {
        if (error instanceof IntegrationError) return badRequest(error.message, 502);
        throw error;
      }
      // The team's discount code must never be mistaken for an affiliate's
      // unclaimed coupon on the catalogue screen.
      if (priced.discount > 0) {
        await SalesCoupon.updateOne(
          { code: TEAM_DISCOUNT_CODE },
          { $set: { ignored: true }, $setOnInsert: { code: TEAM_DISCOUNT_CODE, discoveredFrom: "Order", status: "Unknown", title: "Sales team discount" } },
          { upsert: true }
        );
      }
    }
    const name = placed?.name ?? ref;

    const order = new SalesTeamOrder({
      name,
      ref,
      channel,
      shopifyOrderId: placed?.id,
      orderNumber: placed?.orderNumber,
      placedAt: new Date(),
      executive: executive._id,
      executiveName: executive.name,
      lead: lead?._id,
      createdBy: auth.session.userId,
      customer: { ...input.customer, country: input.customer.country || "India" },
      items: pricedLines,
      pricing: {
        label: handbook.label, mrpTotal: handbook.mrpTotal, offerTotal: handbook.offerTotal, prepaidOff: handbook.prepaidOff,
        extraOff: handbook.extraOff, extra: handbook.extraOff > 0, freeBag: Boolean(input.freeBag)
      },
      totals: { gross: priced.gross, discount: priced.discount, paid: priced.total },
      paymentMode: mode,
      paymentMethod: mode === "Prepaid" ? "Prepaid" : "COD",
      financialStatus: mode === "Prepaid" ? "paid" : mode === "Partial" ? "partially_paid" : "pending",
      advancePaid: advance,
      paymentReference: input.paymentReference || undefined,
      collectAmount: collectAmountOf(mode, priced.total, advance),
      notes: input.notes || undefined
    });
    applyRule(order, ruleFor(settings.incentiveRules, mode));
    recalculateIncentive(order);

    /*
     * The RTO risk as it stood when the order was placed. The courier check is
     * given a few seconds and no more — a slow Shiprocket must not hold up a sale
     * — and without it the score is worked out from the delivery history alone.
     */
    const riskInput = {
      pinCode: input.customer.pinCode, phone: input.customer.phone, paymentMode: mode, total: priced.total, advance,
      address1: input.customer.address1, address2: input.customer.address2 || undefined, city: input.customer.city
    };
    const assessed = await Promise.race([
      preOrderCheck(riskInput),
      new Promise<null>(resolve => setTimeout(() => resolve(null), 6000))
    ]).catch(() => null) ?? await preOrderCheck({ ...riskInput, askCourier: false }).catch(() => null);
    if (assessed) order.set("rtoRisk", assessed.risk);

    try {
      await order.save();
    } catch (error) {
      // Nothing here knows of the order, so it must not stay live in the shop
      // either: an order nobody can see is a parcel nobody ships.
      if (placed && shop) await cancelShopifyOrder(shop, placed.id, "Could not be recorded in the CRM").catch(() => undefined);
      throw error;
    }

    if (lead) {
      await SalesLead.updateOne({ _id: lead._id }, {
        $set: { status: "Converted", convertedAt: new Date(), updatedBy: auth.session.userId },
        $push: {
          remarks: {
            text: `Order ${name} placed — ${formatRupees(priced.total)}, ${PAYMENT_MODE_LABEL[mode].toLowerCase()}.`,
            channel: "Note",
            status: "Converted",
            at: new Date(),
            by: auth.session.userId,
            byName: auth.session.name || undefined
          }
        }
      });
    }

    await record({
      actor: auth.session.userId,
      action: "team.order.created",
      entityType: "SalesTeamOrder",
      entityId: order._id,
      metadata: { name, ref, channel, shopifyOrderId: placed?.id, executive: executive.name, total: priced.total, mode, lead: lead?.name }
    });

    return ok({ _id: order._id, name, ref, channel }, 201);
  } catch (error) {
    return fail(error);
  }
}
