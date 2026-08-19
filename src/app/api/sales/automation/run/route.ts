import { connectDb } from "@/lib/db/mongoose";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { fail, ok } from "@/lib/api";
import { record } from "@/lib/audit";
import { drainQueue } from "@/lib/sales/outreach-engine";

/**
 * Sends what is waiting.
 *
 * Two callers, as with the sync's cron: a scheduler presenting `CRON_SECRET` —
 * the shape Vercel Cron sends — and a person pressing Send now on the panel.
 * The queue is normally drained the moment leads are saved, so this is for
 * whatever that run did not reach: the cap rolling over at the day's end, a
 * batch too big for one function call, Meta having been down for an hour.
 */
async function run(request: Request, scheduledAllowed: boolean) {
  try {
    const secret = process.env.CRON_SECRET;
    const presented = request.headers.get("authorization");
    const scheduled = scheduledAllowed && Boolean(secret) && presented === `Bearer ${secret}`;

    let actor: string | undefined;
    if (!scheduled) {
      const auth = await apiSession(can.manageSales);
      if ("response" in auth) return auth.response;
      actor = auth.session.userId;
    }

    await connectDb();
    const report = await drainQueue({ trigger: scheduled ? "Scheduled" : "Manual" });

    if (actor && (report.sent || report.failed)) {
      await record({
        actor,
        action: "sales.automation.sent",
        entityType: "SalesOutreachMessage",
        // A batch, not a document — an id here fails the ObjectId cast (§11).
        entityId: undefined,
        metadata: { sent: report.sent, failed: report.failed, skipped: report.skipped, remaining: report.remaining }
      });
    }

    return ok({ ...report, scheduled });
  } catch (error) {
    return fail(error);
  }
}

export const GET = (request: Request) => run(request, true);
export const POST = (request: Request) => run(request, false);
