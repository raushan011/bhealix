import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { SalesPayout } from "@/models/Sales";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok, pageParams } from "@/lib/api";
import { record } from "@/lib/audit";
import { todayIso } from "@/lib/time";
import { previewPayout, savePayoutRun } from "@/lib/sales/payout-run";
import { proposePeriod } from "@/lib/sales/payouts";
import { backfillDaysOf, loadSettings } from "@/lib/sales/settings";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

const schema = z.object({
  action: z.enum(["preview", "generate"]),
  from: z.string().regex(ISO).optional(),
  to: z.string().regex(ISO).optional()
});

export async function GET(request: Request) {
  try {
    const auth = await apiSession(can.viewSales);
    if ("response" in auth) return auth.response;
    await connectDb();

    const { page, limit, skip } = pageParams(request.url);
    const [runs, total, last, settings] = await Promise.all([
      SalesPayout.find({}).sort({ to: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
      SalesPayout.countDocuments({}),
      SalesPayout.findOne({}).sort({ to: -1 }).select("to").lean() as Promise<{ to?: string } | null>,
      loadSettings()
    ]);

    return ok({
      items: runs,
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
      /** What the next run would cover, so the screen can offer it. */
      proposed: proposePeriod(last?.to, todayIso(), backfillDaysOf(settings)),
      mayRun: can.runSalesPayout(auth.session.role),
      mayApprove: can.approveSalesPayout(auth.session.role)
    });
  } catch (error) {
    return fail(error);
  }
}

/**
 * `preview` writes nothing; `generate` creates the run and claims its
 * commissions. The same split payroll uses, and for the same reason — somebody
 * should be able to look at a week's figures before committing to them.
 */
export async function POST(request: Request) {
  try {
    const auth = await apiSession(can.runSalesPayout);
    if ("response" in auth) return auth.response;
    await connectDb();

    const input = schema.parse(await request.json());
    const settings = await loadSettings();
    const last = await SalesPayout.findOne({}).sort({ to: -1 }).select("to").lean() as { to?: string } | null;
    const fallback = proposePeriod(last?.to, todayIso(), backfillDaysOf(settings));
    const period = { from: input.from ?? fallback.from, to: input.to ?? fallback.to };

    if (period.from > period.to) return badRequest("A payout period cannot end before it begins.");
    if (period.to > todayIso()) return badRequest("A payout period cannot close in the future — commissions have not matured yet.");

    if (input.action === "preview") {
      const preview = await previewPayout(period);
      return ok({ period, ...preview, holdDays: settings.holdDays ?? 7 });
    }

    const open = await SalesPayout.findOne({ status: "Draft" }).select("payoutNo").lean() as { payoutNo?: string } | null;
    if (open) {
      return badRequest(`Payout run ${open.payoutNo} is still a draft. Approve or delete it before starting another, or the same commissions will be split across two runs.`, 409);
    }

    const run = await savePayoutRun(period, auth.session.userId);
    await record({
      actor: auth.session.userId,
      action: "sales.payout.generated",
      entityType: "SalesPayout",
      entityId: String(run._id),
      metadata: { payoutNo: run.payoutNo, period, totals: run.totals }
    });

    return ok({ _id: run._id, payoutNo: run.payoutNo, totals: run.totals }, 201);
  } catch (error) {
    return fail(error);
  }
}
