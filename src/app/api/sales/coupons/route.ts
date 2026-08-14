import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { SalesCoupon, SalesRep } from "@/models/Sales";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok, OBJECT_ID } from "@/lib/api";
import { record } from "@/lib/audit";
import { loadCatalogue, refreshFromShopify } from "@/lib/sales/catalogue";
import { isRepCode, normaliseCode, REP_CODE_SHAPE } from "@/lib/sales/coupons";
import { PAYOUT_MODES } from "@/lib/sales/constants";
import { provisionCoupon } from "@/lib/sales/provision";
import { loadSettings, rulesOf } from "@/lib/sales/settings";

/**
 * Every coupon code in one place, and the two things anybody wants to do from
 * there: give a code to a rep, or say it belongs to nobody.
 *
 * Assignment writes to `SalesRep.coupons`, which stays the only record of who
 * holds what. The catalogue is never the owner.
 */

const assign = z.object({
  action: z.literal("assign"),
  code: z.string().trim().min(2).max(40),
  rep: z.string().regex(OBJECT_ID),
  suffix: z.string().trim().regex(/^\d{1,3}$/, "Choose which rule this code pays under")
});

const createRep = z.object({
  action: z.literal("create-rep"),
  code: z.string().trim().min(2).max(40),
  suffix: z.string().trim().regex(/^\d{1,3}$/, "Choose which rule this code pays under"),
  name: z.string().trim().min(2, "Enter the partner's name"),
  repCode: z.string().trim().regex(REP_CODE_SHAPE, "A partner code is letters and digits with no spaces"),
  phone: z.string().trim().max(20).optional(),
  payMethod: z.enum(PAYOUT_MODES).default("UPI"),
  upiId: z.string().trim().max(80).optional()
});

const mark = z.object({
  action: z.enum(["ignore", "unignore"]),
  code: z.string().trim().min(2).max(40)
});

/**
 * The two ways to clear a code a rep minted that never reached the shop.
 *
 * `retry` asks Shopify again — the usual fix once the missing scope has been
 * granted or the rule's customer discount has been filled in. `mark-live` says
 * "the discount exists over there, I made it myself", which is the answer when
 * Shopify refused because the code was already taken.
 */
const setup = z.object({
  action: z.enum(["retry-setup", "mark-live"]),
  code: z.string().trim().min(2).max(40)
});

const schema = z.discriminatedUnion("action", [assign, createRep, mark, setup]);

export async function GET(request: Request) {
  try {
    const auth = await apiSession(can.viewSales);
    if ("response" in auth) return auth.response;
    await connectDb();

    // Only on request: the list is read far more often than the shop changes,
    // and every refresh is a GraphQL round trip somebody waits for.
    let refreshError: string | undefined;
    if (new URL(request.url).searchParams.get("refresh") === "1" && can.manageSales(auth.session.role)) {
      try {
        await refreshFromShopify();
      } catch (error) {
        refreshError = error instanceof Error ? error.message : "Could not read the shop's discount list.";
      }
    }

    const [coupons, reps, settings] = await Promise.all([
      loadCatalogue(),
      SalesRep.find({ active: true }).sort({ name: 1 }).select("name code").lean(),
      loadSettings()
    ]);

    return ok({
      coupons,
      reps,
      rules: rulesOf(settings).filter(rule => rule.active),
      refreshError,
      mayManage: can.manageSales(auth.session.role)
    });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await apiSession(can.manageSales);
    if ("response" in auth) return auth.response;
    await connectDb();

    const input = schema.parse(await request.json());
    const code = normaliseCode(input.code);

    // Narrowed with positive checks rather than by ruling the others out: the
    // mark member's discriminant is itself a union ("ignore" | "unignore"), and
    // excluding both literals does not always reduce it away.
    if (input.action === "assign" || input.action === "create-rep") {
      // No two reps may hold the same code — the database enforces it, but
      // saying whose it is beats a duplicate-key error.
      const clash = await SalesRep.findOne({ "coupons.code": code }).select("name").lean() as { name?: string } | null;
      if (clash) return badRequest(`${clash.name} already holds ${code}.`, 409);
    }

    if (input.action === "create-rep") {
      const repCode = normaliseCode(input.repCode);
      if (!isRepCode(repCode)) return badRequest("A partner code is letters and digits with no spaces, like RAUSHAN.");
      if (await SalesRep.findOne({ code: repCode }).lean()) return badRequest(`A partner with the code ${repCode} already exists. Assign this coupon to them instead.`, 409);

      const rep = await SalesRep.create({
        name: input.name,
        code: repCode,
        phone: input.phone,
        payMethod: input.payMethod,
        upiId: input.upiId,
        coupons: [{ code, suffix: input.suffix, active: true }],
        createdBy: auth.session.userId
      });

      await record({
        actor: auth.session.userId, action: "sales.rep.created",
        entityType: "SalesRep", entityId: String(rep._id),
        metadata: { code: repCode, coupons: [code], from: "coupons screen" }
      });
      return ok({ rep: { _id: rep._id, name: rep.name, code: rep.code } }, 201);
    }

    if (input.action === "assign") {
      const rep = await SalesRep.findById(input.rep);
      if (!rep) return badRequest("No such partner", 404);

      rep.coupons = [...(rep.coupons ?? []), { code, suffix: input.suffix, active: true }];
      await rep.save();

      await record({
        actor: auth.session.userId, action: "sales.rep.updated",
        entityType: "SalesRep", entityId: String(rep._id),
        metadata: { code: rep.code, assigned: code, suffix: input.suffix }
      });

      // A code assigned now attributes the orders it already brought in, but
      // only once a sync re-reads them — worth saying so on screen.
      return ok({ rep: { _id: rep._id, name: rep.name, code: rep.code }, resyncNeeded: true });
    }

    if (input.action === "retry-setup" || input.action === "mark-live") {
      const rep = await SalesRep.findOne({ "coupons.code": code });
      if (!rep) return badRequest("No partner holds that code.", 404);

      const coupon = (rep.coupons ?? []).find((held: { code: string }) => held.code === code);
      if (!coupon) return badRequest("No partner holds that code.", 404);

      if (input.action === "mark-live") {
        // Taking the administrator's word for it. There is no way to verify
        // from here that the discount over there is the *right* one, so the
        // action is deliberately explicit rather than something a retry could
        // do quietly on their behalf.
        await SalesRep.updateOne(
          { _id: rep._id, "coupons.code": code },
          { $set: { "coupons.$.setup": "Live" }, $unset: { "coupons.$.setupError": "" } }
        );
        await record({
          actor: auth.session.userId, action: "sales.coupon.provisioned",
          entityType: "SalesRep", entityId: String(rep._id), metadata: { code, by: "marked live by hand" }
        });
        return ok({ code, setup: "Live" });
      }

      const settings = await loadSettings();
      const rule = rulesOf(settings).find(candidate => candidate.suffix === coupon.suffix);
      if (!rule) return badRequest(`No commission rule ends in ${coupon.suffix}, so there is nothing to create this code from.`);

      const outcome = await provisionCoupon({ code, rule, repName: rep.name });

      await SalesRep.updateOne(
        { _id: rep._id, "coupons.code": code },
        {
          $set: {
            "coupons.$.setup": outcome.state,
            ...(outcome.state === "Live"
              ? { "coupons.$.shopifyDiscountId": outcome.shopifyDiscountId }
              : { "coupons.$.setupError": outcome.reason })
          },
          ...(outcome.state === "Live" ? { $unset: { "coupons.$.setupError": "" } } : {})
        }
      );

      await record({
        actor: auth.session.userId,
        action: outcome.state === "Live" ? "sales.coupon.provisioned" : "sales.coupon.setup.failed",
        entityType: "SalesRep", entityId: String(rep._id),
        metadata: { code, state: outcome.state, ...(outcome.state === "Live" ? {} : { reason: outcome.reason }) }
      });

      return ok({
        code,
        setup: outcome.state,
        message: outcome.state === "Live"
          ? `${code} now exists in Shopify and works at the checkout.`
          : outcome.reason
      });
    }

    // Only "not a rep's" and its undo are left.
    const ignored = input.action === "ignore";
    await SalesCoupon.updateOne({ code }, { $set: { ignored }, $setOnInsert: { code } }, { upsert: true });
    return ok({ code, ignored });
  } catch (error) {
    return fail(error);
  }
}
