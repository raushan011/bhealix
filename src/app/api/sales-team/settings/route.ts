import { connectDb } from "@/lib/db/mongoose";
import { SalesTeamOrder, SalesTeamSettings } from "@/models/SalesTeam";
import { apiSession } from "@/lib/auth/guard";
import { can, usesExecutivePanel } from "@/constants/access";
import { badRequest, fail, ok } from "@/lib/api";
import { record } from "@/lib/audit";
import { ruleFor, type TeamPaymentMode } from "@/lib/sales-team/orders";
import { rulesSchema } from "@/lib/sales-team/schemas";
import { applyRule, loadTeamSettings, recalculateIncentive, shopifyReadiness } from "@/lib/sales-team/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The incentive rules. Readable by the desk and by every executive — the people
 * being paid by a rule should be able to see it — and changed by the
 * administrator alone.
 */
export async function GET() {
  try {
    const auth = await apiSession();
    if ("response" in auth) return auth.response;
    if (!can.viewSalesTeam(auth.session.role) && !usesExecutivePanel(auth.session.role)) {
      return badRequest("You do not have access to the sales team", 403);
    }
    await connectDb();
    const settings = await loadTeamSettings();
    // Whether the shop can take orders right now, said here so the settings
    // screen and the order form can warn before anybody types a whole order.
    const shopify = settings.orderChannel === "Shopify" ? await shopifyReadiness() : null;
    return ok({
      incentiveRules: settings.incentiveRules,
      orderChannel: settings.orderChannel,
      shopifyRefusal: shopify?.refusal ?? null,
      mayEdit: can.manageSalesTeam(auth.session.role)
    });
  } catch (error) {
    return fail(error);
  }
}

/**
 * Changes what a COD, prepaid or part-paid order earns.
 *
 * By default a change applies to orders placed from now on, because each order
 * carries the rule it was placed under — an executive who closed a sale on 5%
 * should not find it worth 3% on Friday. `applyToUnpaid` is the administrator
 * saying otherwise, out loud: every order not yet paid is re-priced at the new
 * rule for its mode, and the reply says how many. A paid incentive is never
 * touched (§4.13a).
 */
export async function PUT(request: Request) {
  try {
    const auth = await apiSession(can.manageSalesTeam);
    if ("response" in auth) return auth.response;
    await connectDb();

    const input = rulesSchema.parse(await request.json());
    const before = (await loadTeamSettings()).incentiveRules;
    await SalesTeamSettings.updateOne({ key: "sales-team" }, {
      $set: { incentiveRules: input.incentiveRules, ...(input.orderChannel ? { orderChannel: input.orderChannel } : {}) }
    }, { upsert: true });

    let repriced = 0;
    if (input.applyToUnpaid) {
      const orders = await SalesTeamOrder.find({ "incentive.status": { $ne: "Paid" } });
      for (const order of orders) {
        applyRule(order, ruleFor(input.incentiveRules, order.paymentMode as TeamPaymentMode));
        recalculateIncentive(order);
        await order.save();
        repriced++;
      }
    }

    await record({
      actor: auth.session.userId, action: "team.incentive.rules.updated", entityType: "SalesTeamSettings", entityId: "sales-team",
      metadata: { before, after: input.incentiveRules, repriced, orderChannel: input.orderChannel }
    });

    return ok({
      incentiveRules: input.incentiveRules,
      orderChannel: input.orderChannel ?? (await loadTeamSettings()).orderChannel,
      repriced,
      message: input.applyToUnpaid
        ? `Rules saved. ${repriced} unpaid order${repriced === 1 ? " was" : "s were"} re-priced at the new rules.`
        : "Rules saved. They apply to orders placed from now on."
    });
  } catch (error) {
    return fail(error);
  }
}
