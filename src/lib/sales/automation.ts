import { z } from "zod";
import { MERGE_FIELDS, render, type Addressable, type MergeField } from "./outreach";

/**
 * The vocabulary of automated outreach, kept free of mongoose and of Meta.
 *
 * `whatsapp.ts` talks to Meta and needs `node:crypto`; `outreach-engine.ts`
 * reads and writes the collections. Both are server-only. The panel in the
 * browser needs the statuses, the rule schema and the preview arithmetic and
 * nothing else — so those live here, where importing them drags in nothing
 * that cannot run in a browser (§4.1).
 */

// ---------------------------------------------------------------- templates

/**
 * A Meta template as this application needs to know it: the words, and how
 * many blanks are in the body.
 *
 * Meta's own object has headers, footers, buttons and a status per language.
 * Only the body has blanks the lead can fill, and only an approved template
 * can be sent, so that is what is kept.
 */
export type MetaTemplate = {
  name: string;
  language: string;
  status: string;
  category?: string;
  body: string;
  /** How many `{{n}}` slots the body has — what a rule must map fields onto. */
  parameterCount: number;
};

/** `{{1}}`, `{{2}}` — Meta numbers its blanks; the CRM's own templates name theirs. */
const NUMBERED = /\{\{\s*(\d+)\s*\}\}/g;

export function parameterCount(body: string): number {
  let highest = 0;
  for (const match of body.matchAll(NUMBERED)) highest = Math.max(highest, Number(match[1]));
  return highest;
}

/**
 * The lead fields dropped into a template's numbered blanks, in order.
 *
 * `{{1}}` takes the first field, `{{2}}` the second. Reuses the merge-field
 * vocabulary of the manual queue — `name`, `area`, `city`, `type` — so the
 * person setting a rule up chooses from the same four words the message
 * screen already taught them.
 */
export function templateValues(fields: readonly string[], lead: Addressable): string[] {
  // `render` already knows the fallbacks: a lead with no area says "your area"
  // rather than sending Meta an empty parameter, which it refuses outright.
  return fields.map(field => render(`{{${field}}}`, lead));
}

/** What the message will actually read once the blanks are filled — for the log and the preview. */
export function previewMetaBody(body: string, values: readonly string[]): string {
  return body.replace(NUMBERED, (whole, index: string) => values[Number(index) - 1] ?? whole);
}

/**
 * Meta refuses a parameter with a newline, a tab or more than four spaces in a
 * row, and refuses the whole message with it. Business names off Google carry
 * all three occasionally.
 */
export const cleanParameter = (value: string) => value.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim() || "-";


// ------------------------------------------------------------- what matches

/** The part of a rule that decides which leads it fires for. */
export type RuleFilter = { leadType?: string; city?: string; enabled?: boolean };

const fold = (value: string | undefined) => (value ?? "").trim().toLowerCase();

/**
 * Whether a lead is one this rule is about.
 *
 * Case-blind and trimmed on both sides, because the type was typed by a person
 * ("beauty parlour", "Beauty Parlour") and the city came off Google. An empty
 * filter matches everything — a rule with no type and no city is "message
 * every lead saved", which is a reasonable thing to want.
 */
export function ruleMatches(rule: RuleFilter, lead: { type?: string; city?: string }): boolean {
  if (rule.enabled === false) return false;
  if (fold(rule.leadType) && fold(rule.leadType) !== fold(lead.type)) return false;
  if (fold(rule.city) && fold(rule.city) !== fold(lead.city)) return false;
  return true;
}

// ------------------------------------------------------------ rule schemas

export const AUTOMATION_TRIGGERS = ["Saved", "Manual", "Scheduled"] as const;
export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];

/** Where an automated message stands. Meta reports the middle three; the ends are ours. */
export const OUTREACH_STATUSES = ["Queued", "Sent", "Delivered", "Read", "Failed"] as const;
export type OutreachStatus = (typeof OUTREACH_STATUSES)[number];

/** Meta's word for it, mapped to ours; anything else leaves the row alone. */
export function statusFromMeta(status: string): OutreachStatus | null {
  switch (status) {
    case "sent": return "Sent";
    case "delivered": return "Delivered";
    case "read": return "Read";
    case "failed": return "Failed";
    default: return null;
  }
}

/**
 * Statuses only ever move forward. Meta delivers reports out of order now and
 * then — a `read` before its `delivered` — and letting the later, lesser report
 * win would show a message somebody read as merely delivered.
 */
const RANK: Record<OutreachStatus, number> = { Queued: 0, Sent: 1, Delivered: 2, Read: 3, Failed: 4 };
export const advances = (from: OutreachStatus, to: OutreachStatus) =>
  to === "Failed" ? from !== "Read" && from !== "Delivered" : RANK[to] > RANK[from];

const mergeField = z.enum(MERGE_FIELDS.map(field => field.token) as [MergeField, ...MergeField[]]);

export const ruleSchema = z.object({
  name: z.string().trim().min(2, "Give the rule a name you will recognise").max(80),
  enabled: z.boolean().default(true),
  /** Which trade this rule fires for. Empty means every type. */
  leadType: z.string().trim().max(60).default(""),
  /** Which city. Empty means everywhere. */
  city: z.string().trim().max(80).default(""),
  /** Skip anybody messaged before, by hand or by a rule. On by default — twice in a week is what gets a number blocked. */
  freshOnly: z.boolean().default(true),
  template: z.object({
    name: z.string().trim().min(1, "Choose an approved template").max(512),
    language: z.string().trim().min(2).max(10),
    /** A snapshot of the body when the rule was written, for the preview and the log. */
    body: z.string().max(4000).default(""),
    /** Which lead field fills each numbered blank, in order. */
    fields: z.array(mergeField).max(10).default([])
  })
});

export type RuleInput = z.infer<typeof ruleSchema>;

export const ruleUpdateSchema = ruleSchema.partial().refine(input => Object.keys(input).length > 0, "Nothing to change");

export const DEFAULT_DAILY_CAP = 200;

export const whatsappSettingsSchema = z.object({
  phoneNumberId: z.string().trim().max(40).optional(),
  businessAccountId: z.string().trim().max(40).optional(),
  /** Blank leaves the stored one alone. */
  accessToken: z.string().trim().max(600).optional(),
  appSecret: z.string().trim().max(200).optional(),
  verifyToken: z.string().trim().max(120).optional(),
  apiVersion: z.string().trim().regex(/^v\d{1,2}\.\d{1,2}$/, "A Graph API version looks like v21.0").optional(),
  autoSend: z.boolean().optional(),
  dailyCap: z.number().int().min(1).max(10000).optional()
});

export type WhatsAppSettingsInput = z.infer<typeof whatsappSettingsSchema>;

/** The path Meta must be told to post to. */
export const WEBHOOK_PATH = "/api/sales/whatsapp/webhook";
