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
  name: z.string().trim().min(2, "Enter the rep's name"),
  repCode: z.string().trim().regex(REP_CODE_SHAPE, "A rep code is letters and digits with no spaces"),
  phone: z.string().trim().max(20).optional(),
  payMethod: z.enum(PAYOUT_MODES).default("UPI"),
  upiId: z.string().trim().max(80).optional()
});

const mark = z.object({
  action: z.enum(["ignore", "unignore"]),
  code: z.string().trim().min(2).max(40)
});

const schema = z.discriminatedUnion("action", [assign, createRep, mark]);

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
      if (!isRepCode(repCode)) return badRequest("A rep code is letters and digits with no spaces, like RAUSHAN.");
      if (await SalesRep.findOne({ code: repCode }).lean()) return badRequest(`A rep with the code ${repCode} already exists. Assign this coupon to them instead.`, 409);

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
      if (!rep) return badRequest("No such rep", 404);

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

    // Only "not a rep's" and its undo are left.
    const ignored = input.action === "ignore";
    await SalesCoupon.updateOne({ code }, { $set: { ignored }, $setOnInsert: { code } }, { upsert: true });
    return ok({ code, ignored });
  } catch (error) {
    return fail(error);
  }
}
