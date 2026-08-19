import { Types } from "mongoose";
import { SalesAutomationRule, SalesLead, SalesOutreachMessage, SalesOutreachReply, SalesSettings } from "@/models/Sales";
import { whatsappNumber } from "./leads";
import { advancesOnSend } from "./outreach";
import {
  DEFAULT_DAILY_CAP, advances, previewMetaBody, ruleMatches, statusFromMeta, templateValues,
  type AutomationTrigger, type OutreachStatus
} from "./automation";
import { loadCredentials, whatsappConfig } from "./settings";
import { sendTemplate, stopsTheRun, type InboundEvent, type StatusEvent } from "./whatsapp";

/**
 * The machinery between "a lead was saved" and "Meta was handed a message".
 *
 * Two halves, deliberately separate. **Queueing** decides who should be
 * messaged and writes a `Queued` row per lead; it is cheap, runs inside the
 * request that saved the leads, and cannot fail that request. **Draining**
 * takes the queue in order and sends, bounded by the daily cap and by how long
 * a serverless function may run — whatever it does not reach stays queued for
 * the next drain, which is the next save, the panel's Send-now button, or the
 * nightly job. Nothing is ever lost between the two; at worst it is late.
 *
 * Everything here writes the lead's own `lastContactedAt`/`contactCount` as
 * the manual queue does, so "only those never messaged" means the same thing
 * whichever way a message went.
 */

type LeadDoc = {
  _id: Types.ObjectId;
  name: string;
  type: string;
  status: string;
  phone?: string;
  area?: string;
  city?: string;
  lastContactedAt?: Date;
};

type RuleDoc = {
  _id: Types.ObjectId;
  name: string;
  enabled: boolean;
  leadType?: string;
  city?: string;
  freshOnly: boolean;
  template: { name: string; language: string; body?: string; fields?: string[] };
};

type MessageDoc = {
  _id: Types.ObjectId;
  lead: Types.ObjectId;
  leadName?: string;
  phone: string;
  rule?: Types.ObjectId;
  ruleName?: string;
  templateName?: string;
  status: OutreachStatus;
  attempts: number;
  waMessageId?: string;
  repliedAt?: Date;
};

const asId = (value: unknown) => new Types.ObjectId(String(value));

// ----------------------------------------------------------------- queueing

export type QueueReport = {
  queued: number;
  /** Why the rest were not: no rule fitted, no usable number, messaged before, already queued. */
  skipped: { noRule: number; noNumber: number; alreadyMessaged: number; alreadyQueued: number };
  /** Empty when the switch is on and at least one rule is enabled. */
  reason?: string;
};

const nothing = (reason?: string): QueueReport =>
  ({ queued: 0, skipped: { noRule: 0, noNumber: 0, alreadyMessaged: 0, alreadyQueued: 0 }, reason });

/**
 * Files a `Queued` row for every lead a rule wants messaged.
 *
 * One row per lead per call, whichever rule matches first: two rules that both
 * fit a parlour are two people who wrote the same instruction, not a request
 * for two messages. The unique index on (lead, rule) makes a re-save of the
 * same sweep a no-op — the duplicate errors are counted, not raised.
 */
export async function queueLeads(leadIds: readonly string[], trigger: AutomationTrigger): Promise<QueueReport> {
  if (!leadIds.length) return nothing();

  const settings = await SalesSettings.findOne({ key: "sales" }).select("whatsappAutoSend").lean() as { whatsappAutoSend?: boolean } | null;
  if (!settings?.whatsappAutoSend) return nothing("Automatic sending is switched off.");

  const rules = await SalesAutomationRule.find({ enabled: true }).sort({ createdAt: 1 }).lean() as unknown as RuleDoc[];
  if (!rules.length) return nothing("No rule is switched on.");

  const leads = await SalesLead.find({ _id: { $in: leadIds.map(asId) } })
    .select("name type status phone area city lastContactedAt").lean() as unknown as LeadDoc[];

  const report = nothing();
  const rows: Record<string, unknown>[] = [];

  for (const lead of leads) {
    const rule = rules.find(candidate => ruleMatches(candidate, lead));
    if (!rule) { report.skipped.noRule++; continue; }

    const phone = whatsappNumber(lead.phone);
    if (!phone) { report.skipped.noNumber++; continue; }
    if (rule.freshOnly && lead.lastContactedAt) { report.skipped.alreadyMessaged++; continue; }

    const values = templateValues(rule.template.fields ?? [], lead);
    rows.push({
      lead: lead._id,
      leadName: lead.name,
      leadType: lead.type,
      city: lead.city,
      phone,
      rule: rule._id,
      ruleName: rule.name,
      templateName: rule.template.name,
      preview: previewMetaBody(rule.template.body ?? "", values),
      trigger,
      status: "Queued",
      queuedAt: new Date()
    });
  }

  if (!rows.length) return report;

  try {
    const inserted = await SalesOutreachMessage.insertMany(rows, { ordered: false });
    report.queued = inserted.length;
  } catch (error) {
    // `ordered: false` writes everything it can and then reports the rest. The
    // duplicates — this lead already has a row for this rule — are the expected
    // failure and are counted as such; anything else is genuinely wrong.
    const bulk = error as { insertedDocs?: unknown[]; writeErrors?: { code?: number }[] };
    const dupes = (bulk.writeErrors ?? []).filter(problem => problem.code === 11000).length;
    if (!bulk.writeErrors || dupes !== bulk.writeErrors.length) throw error;
    report.queued = bulk.insertedDocs?.length ?? rows.length - dupes;
    report.skipped.alreadyQueued = dupes;
  }

  return report;
}

/** How many saved leads a rule would fire for right now — shown on the rule so a filter typo is visible. */
export async function countMatching(rule: { leadType?: string; city?: string; freshOnly?: boolean }): Promise<number> {
  return SalesLead.countDocuments(matchingWhere(rule));
}

const matchingWhere = (rule: { leadType?: string; city?: string; freshOnly?: boolean }) => {
  const where: Record<string, unknown> = { phone: { $exists: true, $ne: "" } };
  const escape = (value: string) => value.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (rule.leadType?.trim()) where.type = new RegExp(`^${escape(rule.leadType)}$`, "i");
  if (rule.city?.trim()) where.city = new RegExp(`^${escape(rule.city)}$`, "i");
  if (rule.freshOnly !== false) where.lastContactedAt = { $exists: false };
  return where;
};

/**
 * Queues every lead already on the list that a rule fits — the "run this over
 * what I have saved" button, for the sweep that was saved before the rule was
 * written. Capped, because a rule with no filter matches the whole list.
 */
export async function queueExisting(ruleId: string, limit = 500): Promise<QueueReport> {
  const rule = await SalesAutomationRule.findById(ruleId).lean() as RuleDoc | null;
  if (!rule) return nothing("That rule no longer exists.");
  if (!rule.enabled) return nothing("Switch the rule on first.");

  const ids = await SalesLead.find(matchingWhere(rule)).select("_id").sort({ createdAt: -1 }).limit(limit).lean() as { _id: Types.ObjectId }[];
  return queueLeads(ids.map(row => String(row._id)), "Manual");
}

// ----------------------------------------------------------------- draining

export type DrainReport = {
  sent: number;
  failed: number;
  /** Queued rows dropped because the lead was messaged by hand in the meantime. */
  skipped: number;
  /** Still waiting — for the cap, or for the next run. */
  remaining: number;
  /** Why the run stopped early, in a sentence for the screen. */
  stoppedBecause?: string;
};

/** Meta counts a business-initiated conversation against a rolling day, so the cap does too. */
const DAY = 24 * 3_600_000;

/** How many one drain will attempt at most: well inside a serverless function's time, five at a time. */
export const DRAIN_BATCH = 60;
const CONCURRENCY = 5;

/**
 * Sends what is queued, oldest first, until the batch, the cap or Meta says
 * stop.
 *
 * A refusal that is about *this recipient* — not on WhatsApp, a dead number —
 * marks that row failed and moves on. A refusal that is about *us* — the token,
 * the rate limit, a template Meta has paused — is written on the settings
 * document where the panel shows it, and the run stops, because every further
 * send would fail the same way and each one costs a fraction of the number's
 * standing with Meta.
 */
export async function drainQueue(options: { trigger: AutomationTrigger; limit?: number } = { trigger: "Manual" }): Promise<DrainReport> {
  const settings = await loadCredentials();
  const config = whatsappConfig(settings);
  const remainingNow = () => SalesOutreachMessage.countDocuments({ status: "Queued" });

  if (!config) return { sent: 0, failed: 0, skipped: 0, remaining: await remainingNow(), stoppedBecause: "WhatsApp is not connected yet." };
  if (!settings.whatsappAutoSend) return { sent: 0, failed: 0, skipped: 0, remaining: await remainingNow(), stoppedBecause: "Automatic sending is switched off." };

  const cap = settings.whatsappDailyCap ?? DEFAULT_DAILY_CAP;
  const sentLastDay = await SalesOutreachMessage.countDocuments({ sentAt: { $gte: new Date(Date.now() - DAY) } });
  const room = Math.max(0, cap - sentLastDay);
  const limit = Math.min(options.limit ?? DRAIN_BATCH, room);

  const report: DrainReport = { sent: 0, failed: 0, skipped: 0, remaining: 0 };
  if (limit === 0) {
    report.remaining = await remainingNow();
    if (report.remaining) report.stoppedBecause = `Today's cap of ${cap} is used up — the rest goes out as the day rolls over.`;
    return report;
  }

  const queued = await SalesOutreachMessage.find({ status: "Queued" }).sort({ queuedAt: 1 }).limit(limit).lean() as unknown as MessageDoc[];
  const rules = new Map<string, RuleDoc>();
  for (const rule of await SalesAutomationRule.find({ _id: { $in: [...new Set(queued.map(row => String(row.rule)))].map(asId) } }).lean() as unknown as RuleDoc[]) {
    rules.set(String(rule._id), rule);
  }

  let stop: string | undefined;

  for (let start = 0; start < queued.length && !stop; start += CONCURRENCY) {
    const slice = queued.slice(start, start + CONCURRENCY);
    const outcomes = await Promise.all(slice.map(async row => {
      const rule = row.rule ? rules.get(String(row.rule)) : undefined;
      if (!rule) {
        await SalesOutreachMessage.updateOne({ _id: row._id }, { $set: { status: "Failed", error: "The rule behind this message was deleted before it went out." } });
        return "failed" as const;
      }

      const lead = await SalesLead.findById(row.lead).select("name type status phone area city lastContactedAt").lean() as LeadDoc | null;
      if (!lead) {
        await SalesOutreachMessage.deleteOne({ _id: row._id });
        return "skipped" as const;
      }
      // Messaged by hand between queueing and now — the manual queue and this
      // one must never both reach the same shop in the same week.
      if (rule.freshOnly && lead.lastContactedAt) {
        await SalesOutreachMessage.deleteOne({ _id: row._id });
        return "skipped" as const;
      }

      const values = templateValues(rule.template.fields ?? [], lead);
      try {
        const result = await sendTemplate(config, row.phone, rule.template, values);
        await Promise.all([
          SalesOutreachMessage.updateOne({ _id: row._id }, {
            $set: {
              status: "Sent", waMessageId: result.messageId, sentAt: new Date(),
              preview: previewMetaBody(rule.template.body ?? "", values), leadName: lead.name
            },
            $unset: { error: "" },
            $inc: { attempts: 1 }
          }),
          SalesLead.updateOne({ _id: lead._id }, {
            $set: { lastContactedAt: new Date(), ...(advancesOnSend(lead.status) ? { status: "Contacted" } : {}) },
            $inc: { contactCount: 1 }
          })
        ]);
        return "sent" as const;
      } catch (error) {
        const message = error instanceof Error ? error.message : "WhatsApp refused the message.";
        if (stopsTheRun(error)) {
          stop = message;
          await SalesOutreachMessage.updateOne({ _id: row._id }, { $set: { error: message }, $inc: { attempts: 1 } });
          return "stopped" as const;
        }
        // A per-number refusal is final at once — retrying a number that is not
        // on WhatsApp three nights running only delays the rows behind it.
        await SalesOutreachMessage.updateOne({ _id: row._id }, { $set: { status: "Failed", error: message }, $inc: { attempts: 1 } });
        return "failed" as const;
      }
    }));

    for (const outcome of outcomes) {
      if (outcome === "sent") report.sent++;
      else if (outcome === "failed") report.failed++;
      else if (outcome === "skipped") report.skipped++;
    }
  }

  await SalesSettings.updateOne({ key: "sales" }, stop
    ? { $set: { lastWhatsappError: stop } }
    : { $unset: { lastWhatsappError: "" } });

  report.remaining = await remainingNow();
  if (stop) report.stoppedBecause = stop;
  else if (report.remaining) {
    report.stoppedBecause = room <= queued.length
      ? `Today's cap of ${cap} is reached — the rest goes out as the day rolls over.`
      : "This run's batch is done — press Send now again, or the rest goes on the next run.";
  }
  return report;
}

// ---------------------------------------------------------------- reporting

/** Meta's word on a message it was handed, written onto the row it is about. */
export async function applyStatuses(events: readonly StatusEvent[]): Promise<number> {
  let touched = 0;
  for (const event of events) {
    const next = statusFromMeta(event.status);
    if (!next) continue;
    const row = await SalesOutreachMessage.findOne({ waMessageId: event.messageId }).select("status").lean() as { status: OutreachStatus } | null;
    if (!row || !advances(row.status, next)) continue;

    const set: Record<string, unknown> = { status: next };
    if (next === "Delivered") set.deliveredAt = event.at;
    if (next === "Read") { set.readAt = event.at; set.deliveredAt = set.deliveredAt ?? event.at; }
    if (next === "Failed" && event.error) set.error = event.error;
    await SalesOutreachMessage.updateOne({ waMessageId: event.messageId }, { $set: set });
    touched++;
  }
  return touched;
}

/**
 * Somebody wrote back.
 *
 * Matched to a lead by the message they replied to when WhatsApp says which,
 * otherwise by the last message this number was sent, otherwise by the digits
 * on the lead itself. Filed once — Meta retries a webhook it thinks was not
 * acknowledged, and the unique id is what stops the second copy — and then
 * written into the lead's remarks so the thread reads whole wherever it is
 * opened.
 */
export async function recordReplies(events: readonly InboundEvent[]): Promise<number> {
  let filed = 0;
  for (const event of events) {
    const outbound = (event.inReplyTo
      ? await SalesOutreachMessage.findOne({ waMessageId: event.inReplyTo }).lean()
      : null) as MessageDoc | null
      ?? await SalesOutreachMessage.findOne({ phone: event.from, status: { $ne: "Queued" } }).sort({ sentAt: -1 }).lean() as MessageDoc | null;

    let leadId = outbound?.lead;
    let leadName = outbound?.leadName;
    if (!leadId) {
      // The lead's phone is stored as typed — "096503 06893" — so match the
      // last ten digits with anything allowed between them.
      const tail = event.from.slice(-10).split("").join("\\D*");
      const lead = await SalesLead.findOne({ phone: new RegExp(`${tail}\\D*$`) }).select("name").lean() as { _id: Types.ObjectId; name: string } | null;
      if (lead) { leadId = lead._id; leadName = lead.name; }
    }

    try {
      await SalesOutreachReply.create({
        lead: leadId,
        leadName,
        phone: event.from,
        profileName: event.profileName,
        message: outbound?._id,
        waMessageId: event.messageId,
        type: event.type,
        text: event.text,
        receivedAt: event.at,
        seen: false
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("duplicate key")) continue;
      throw error;
    }
    filed++;

    if (outbound && !outbound.repliedAt) {
      await SalesOutreachMessage.updateOne({ _id: outbound._id }, { $set: { repliedAt: event.at } });
    }
    if (leadId) {
      await SalesLead.updateOne({ _id: leadId }, {
        $push: {
          remarks: {
            text: `Replied on WhatsApp: ${event.text}`.slice(0, 1000),
            channel: "WhatsApp",
            at: event.at,
            byName: event.profileName ? `${event.profileName} (WhatsApp)` : "WhatsApp"
          }
        }
      });
    }
  }
  return filed;
}

// ----------------------------------------------------------------- overview

export type AutomationCounts = {
  queued: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  replied: number;
  /** In the rolling day — what the cap is measured against. */
  sentToday: number;
  unreadReplies: number;
  totalReplies: number;
};

/** The figures across the top of the panel. */
export async function automationCounts(): Promise<AutomationCounts> {
  const [byStatus, replied, sentToday, unreadReplies, totalReplies] = await Promise.all([
    SalesOutreachMessage.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]) as Promise<{ _id: OutreachStatus; count: number }[]>,
    SalesOutreachMessage.countDocuments({ repliedAt: { $exists: true } }),
    SalesOutreachMessage.countDocuments({ sentAt: { $gte: new Date(Date.now() - DAY) } }),
    SalesOutreachReply.countDocuments({ seen: false }),
    SalesOutreachReply.countDocuments()
  ]);
  const count = (status: OutreachStatus) => byStatus.find(row => row._id === status)?.count ?? 0;
  // "Sent" on the panel means "left here", so it includes what has since been
  // delivered or read — the funnel narrows from left to right.
  return {
    queued: count("Queued"),
    sent: count("Sent") + count("Delivered") + count("Read"),
    delivered: count("Delivered") + count("Read"),
    read: count("Read"),
    failed: count("Failed"),
    replied,
    sentToday,
    unreadReplies,
    totalReplies
  };
}

/** Per rule: how many went out and how many wrote back, so a message that nobody answers is visible as such. */
export async function ruleStats(): Promise<Record<string, { queued: number; sent: number; replied: number; failed: number }>> {
  const rows = await SalesOutreachMessage.aggregate([
    { $group: {
      _id: "$rule",
      queued: { $sum: { $cond: [{ $eq: ["$status", "Queued"] }, 1, 0] } },
      sent: { $sum: { $cond: [{ $in: ["$status", ["Sent", "Delivered", "Read"]] }, 1, 0] } },
      failed: { $sum: { $cond: [{ $eq: ["$status", "Failed"] }, 1, 0] } },
      replied: { $sum: { $cond: [{ $ifNull: ["$repliedAt", false] }, 1, 0] } }
    } }
  ]) as { _id: Types.ObjectId | null; queued: number; sent: number; replied: number; failed: number }[];
  return Object.fromEntries(rows.filter(row => row._id).map(row => [String(row._id), { queued: row.queued, sent: row.sent, replied: row.replied, failed: row.failed }]));
}
