import { connectDb } from "@/lib/db/mongoose";
import { SalesTeamOrder } from "@/models/SalesTeam";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { record } from "@/lib/audit";
import { processStateOf } from "@/lib/sales/fulfilment";
import { isExecutive, mayActOn, orderScope } from "@/lib/sales-team/access";
import { collectAmountOf, paymentProblem, priceOrder, ruleFor, type TeamPaymentMode } from "@/lib/sales-team/orders";
import { orderPatchSchema } from "@/lib/sales-team/schemas";
import { activeExecutive, applyRule, loadTeamSettings, recalculateIncentive, shopifyReadiness } from "@/lib/sales-team/server";
import { cancelShopifyOrder } from "@/lib/sales-team/shopify-api";
import { shopifyAdminOrderUrl } from "@/lib/sales-team/shopify-order";
import { IntegrationError } from "@/lib/sales/http";
import { loadSettings } from "@/lib/sales/settings";
import { normaliseDomain } from "@/lib/sales/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** One order, with what this person may do to it worked out on the server. */
export async function GET(_: Request, { params }: Params) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    const scope = orderScope(auth.session);
    if (!scope) return badRequest("You do not have access to the sales team's orders", 403);
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Unknown order");
    await connectDb();

    const order = await SalesTeamOrder.findOne({ _id: id, ...scope })
      .populate("executive", "name employeeId phone")
      .populate("lead", "name phone type city")
      .populate("createdBy", "name")
      .populate("shipment.processedBy", "name")
      .populate("cancelledBy", "name")
      .populate("incentive.payment.paidBy", "name")
      .lean() as Record<string, unknown> & {
        executive?: { _id: unknown } | null; cancelledAt?: Date; incentive?: { status?: string }; shopifyOrderId?: string;
        shipment?: { shiprocketOrderId?: string; awb?: string; pickupScheduledAt?: Date };
      } | null;
    if (!order) return badRequest("That order could not be found", 404);

    const acts = mayActOn(auth.session, order.executive?._id);
    const live = !order.cancelledAt;
    const atCourier = Boolean(order.shipment?.shiprocketOrderId);
    const inShop = Boolean(order.shopifyOrderId);
    const shopDomain = inShop && !isExecutive(auth.session) ? (await loadSettings()).shopifyDomain : undefined;

    return ok({
      order,
      processState: processStateOf(order as never),
      // The shop's own page for the order, for the desk: executives do not sign in to Shopify.
      shopifyUrl: shopDomain && order.shopifyOrderId ? shopifyAdminOrderUrl(normaliseDomain(shopDomain), String(order.shopifyOrderId)) : undefined,
      may: {
        // A Shopify order is changed in Shopify; here it can only be cancelled and placed again.
        edit: acts && live && !atCourier && !inShop,
        cancel: acts && live && (inShop ? !order.shipment?.awb : !atCourier),
        book: acts && live && !order.shipment?.awb,
        track: Boolean(order.shipment?.awb),
        documents: atCourier,
        override: can.manageSalesTeam(auth.session.role),
        reassign: can.manageSalesTeam(auth.session.role) && order.incentive?.status !== "Paid",
        pay: can.paySalesIncentive(auth.session.role)
      }
    });
  } catch (error) {
    return fail(error);
  }
}

/**
 * Changes to an order: an edit before it goes to the courier, a cancellation,
 * a delivery corrected by hand, or the order moved to another executive.
 *
 * Once Shiprocket holds the order it is not edited or cancelled from here. The
 * courier's copy is the one the parcel ships against, and an order changed on
 * one side only is how a customer is charged one figure and collected another.
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!OBJECT_ID.test(id)) return badRequest("Unknown order");
    await connectDb();

    // Refused before the body is read, so a role with no business here learns
    // nothing from a validation message.
    const scope = orderScope(auth.session);
    if (!scope) return badRequest("You do not have access to the sales team's orders", 403);
    const input = orderPatchSchema.parse(await request.json());
    const order = await SalesTeamOrder.findOne({ _id: id, ...scope });
    if (!order) return badRequest("That order could not be found", 404);

    const atCourier = Boolean(order.shipment?.shiprocketOrderId);
    const inShop = Boolean(order.shopifyOrderId);

    if (input.action === "edit" || input.action === "cancel") {
      if (!mayActOn(auth.session, order.executive)) return badRequest("You do not have access to this action", 403);
      if (order.cancelledAt) return badRequest("This order has already been cancelled.");
      if (inShop && input.action === "edit") {
        return badRequest(`This order is in Shopify as ${order.name}. Cancel it and place it again, or change it in Shopify.`);
      }
      if (inShop && order.shipment?.awb) {
        return badRequest(`This parcel already has an airway bill (${order.shipment.awb}). Cancel the shipment in Shiprocket first; the next refresh brings the cancellation back here.`);
      }
      if (!inShop && atCourier) {
        return badRequest(`This order is already with Shiprocket (order ${order.shipment.shiprocketOrderId}). `
          + `${input.action === "cancel" ? "Cancel" : "Change"} it there; the next status refresh brings the result back here.`);
      }
    }

    if (input.action === "edit") {
      const mode = input.order.paymentMode as TeamPaymentMode;
      const priced = priceOrder(input.order.items, input.order.discount);
      const advance = mode === "Prepaid" ? priced.total : mode === "COD" ? 0 : input.order.advancePaid;
      const problem = paymentProblem(mode, priced.total, advance);
      if (problem) return badRequest(problem);

      // A different payment mode is a different promise, so it takes that mode's
      // current rule; an unchanged mode keeps the rule the order was placed under.
      if (mode !== order.paymentMode) applyRule(order, ruleFor((await loadTeamSettings()).incentiveRules, mode));

      order.set({
        customer: { ...input.order.customer, country: input.order.customer.country || "India" },
        items: priced.lines.map((line, index) => ({ ...line, product: input.order.items[index]?.product })),
        totals: { gross: priced.gross, discount: priced.discount, paid: priced.total },
        paymentMode: mode,
        paymentMethod: mode === "Prepaid" ? "Prepaid" : "COD",
        financialStatus: mode === "Prepaid" ? "paid" : mode === "Partial" ? "partially_paid" : "pending",
        advancePaid: advance,
        paymentReference: input.order.paymentReference || undefined,
        collectAmount: collectAmountOf(mode, priced.total, advance),
        notes: input.order.notes || undefined
      });
      recalculateIncentive(order);
      await order.save();
      await record({ actor: auth.session.userId, action: "team.order.edited", entityType: "SalesTeamOrder", entityId: order._id,
        metadata: { name: order.name, total: priced.total, mode } });
      return ok({ _id: order._id });
    }

    if (input.action === "cancel") {
      // Cancelled in the shop first, which also puts its stock back, so the two
      // can never disagree about whether this order is live.
      if (inShop) {
        const { config } = await shopifyReadiness();
        if (!config) return badRequest("Shopify is not connected, so the order cannot be cancelled there. Cancel it in Shopify; the next refresh brings it back here.", 502);
        try {
          await cancelShopifyOrder(config, String(order.shopifyOrderId), input.reason);
        } catch (error) {
          if (error instanceof IntegrationError) return badRequest(error.message, 502);
          throw error;
        }
      }
      order.set({ cancelledAt: new Date(), cancelReason: input.reason, cancelledBy: auth.session.userId });
      recalculateIncentive(order);
      await order.save();
      await record({ actor: auth.session.userId, action: "team.order.cancelled", entityType: "SalesTeamOrder", entityId: order._id,
        metadata: { name: order.name, reason: input.reason } });
      return ok({ _id: order._id });
    }

    if (input.action === "override") {
      if (!can.manageSalesTeam(auth.session.role)) return badRequest("Only an administrator can correct a delivery by hand", 403);
      if (input.state) {
        order.set({ "delivery.override": input.state, "delivery.overrideReason": input.reason, "delivery.overrideBy": auth.session.userId, "delivery.overrideAt": new Date(), "delivery.at": new Date() });
      } else {
        order.set({ "delivery.override": undefined, "delivery.overrideReason": undefined, "delivery.overrideBy": undefined, "delivery.overrideAt": undefined });
      }
      recalculateIncentive(order);
      await order.save();
      await record({ actor: auth.session.userId, action: "team.delivery.overridden", entityType: "SalesTeamOrder", entityId: order._id,
        metadata: { name: order.name, state: input.state, reason: input.reason } });
      return ok({ _id: order._id, incentive: order.incentive?.status });
    }

    // reassign
    if (!can.manageSalesTeam(auth.session.role) || isExecutive(auth.session)) return badRequest("Only an administrator can move an order", 403);
    if (order.incentive?.status === "Paid") return badRequest("This order's incentive has already been paid to the executive who placed it. Undo the payment first.");
    const executive = await activeExecutive(input.executive);
    if (!executive) return badRequest("That person is not an active sales executive.");
    const from = order.executiveName;
    order.set({ executive: executive._id, executiveName: executive.name });
    await order.save();
    await record({ actor: auth.session.userId, action: "team.order.reassigned", entityType: "SalesTeamOrder", entityId: order._id,
      metadata: { name: order.name, from, to: executive.name } });
    return ok({ _id: order._id });
  } catch (error) {
    return fail(error);
  }
}
