import { Types } from "mongoose";
import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { FinancePeriod } from "@/models/Finance";
import { apiSession } from "@/lib/auth/guard";
import { can } from "@/constants/access";
import { badRequest, fail, ok } from "@/lib/api";
import { record } from "@/lib/audit";
import { summarise } from "@/lib/finance/documents";
import { formatPeriod, isPeriod } from "@/lib/finance/period";
import { EXPECTED_SOURCES } from "@/lib/finance/sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  period: z.string().refine(isPeriod, "Choose a month"),
  /** `true` marks it sent, `false` takes that back. Absent leaves it as it was. */
  handedOver: z.boolean().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
  /** Sending a month that is short of a vendor is allowed, but only on purpose. */
  force: z.boolean().optional()
});

/**
 * A month's own state: sent to the accountant, and the note beside it.
 *
 * Separate from the documents because it answers a question they cannot. A month
 * can be complete without having been sent, and — more awkwardly — sent while
 * still incomplete, which happens every time a vendor is slow and the return
 * cannot wait. Recording the date it went is what lets somebody answer "when did
 * you send me August" three weeks later without going through their sent items.
 *
 * Marking a month sent while a source is missing is refused *once*, with the
 * missing vendors named, and allowed on a second press. That is the shape this
 * warning has to take: a hard refusal would be wrong, since sending an
 * incomplete month is a real and reasonable act, and a silent success would make
 * the checklist above it decorative.
 */
export async function PATCH(request: Request) {
  try {
    const auth = await apiSession(can.manageFinance);
    if ("response" in auth) return auth.response;
    await connectDb();

    const input = schema.parse(await request.json());
    const summary = await summarise(input.period);

    if (input.handedOver === true && summary.missing.length && !input.force) {
      const names = summary.missing
        .map(key => EXPECTED_SOURCES.find(source => source.key === key))
        .filter(Boolean)
        .map(source => `${source!.vendor} ${source!.label.toLowerCase()}`);

      return ok({
        confirm: true,
        summary,
        message: `${formatPeriod(input.period)} still has nothing filed for ${names.join(", ")}. Send it anyway?`
      });
    }

    const set: Record<string, unknown> = {};
    const unset: Record<string, ""> = {};

    if (input.handedOver === true) {
      set.handedOverAt = new Date();
      set.handedOverBy = new Types.ObjectId(auth.session.userId);
    } else if (input.handedOver === false) {
      unset.handedOverAt = "";
      unset.handedOverBy = "";
    }

    if (input.note !== undefined) {
      if (input.note) set.note = input.note;
      else unset.note = "";
    }

    if (!Object.keys(set).length && !Object.keys(unset).length) return badRequest("Nothing to change");

    await FinancePeriod.findOneAndUpdate(
      { period: input.period },
      {
        $setOnInsert: { period: input.period },
        ...(Object.keys(set).length ? { $set: set } : {}),
        ...(Object.keys(unset).length ? { $unset: unset } : {})
      },
      { upsert: true, setDefaultsOnInsert: true }
    );

    if (input.handedOver !== undefined) {
      await record({
        actor: auth.session.userId,
        action: input.handedOver ? "finance.period.handed-over" : "finance.period.reopened",
        entityType: "FinancePeriod",
        entityId: input.period,
        metadata: { period: input.period, documents: summary.documents, missing: summary.missing, forced: Boolean(input.force) }
      });
    } else if (input.note !== undefined) {
      await record({
        actor: auth.session.userId,
        action: "finance.period.noted",
        entityType: "FinancePeriod",
        entityId: input.period,
        metadata: { period: input.period, cleared: !input.note }
      });
    }

    return ok({
      summary: await summarise(input.period),
      message: input.handedOver === true ? `${formatPeriod(input.period)} marked as sent to the accountant.`
        : input.handedOver === false ? `${formatPeriod(input.period)} reopened.`
        : "Note saved."
    });
  } catch (error) {
    return fail(error);
  }
}
