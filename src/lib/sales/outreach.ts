import { z } from "zod";
import { whatsappNumber } from "@/lib/sales/leads";

/**
 * Saying the same thing to two hundred parlours, one tap at a time.
 *
 * The list next door answers "who is worth ringing". This answers the question
 * that immediately follows it, which is that somebody now has to write "Hi, we
 * work with parlours in Indirapuram…" two hundred times, and will not.
 *
 * The mechanism is deliberately the dullest one available: a `wa.me` link with
 * the message already in it. Tapping it opens WhatsApp — the real app on a
 * phone, WhatsApp Web on a desk — with the text sitting in the compose box, and
 * a human presses send. Nothing here automates the send itself.
 *
 * That is not timidity, it is the only version that survives. Automated bulk
 * sending is against WhatsApp's terms, is detected, and is answered by banning
 * the *number* — which for this company is the number on the packaging. A
 * prefilled link is a documented feature of WhatsApp's own that costs nothing
 * and cannot be withdrawn. It gets the ninety seconds of typing down to one
 * tap, which was the whole problem; the press of the send key was never the
 * slow part.
 *
 * Pure: no mongoose, no react. Rendering runs in the browser to show the
 * preview and on the server to record what was sent, so the two can never
 * disagree about what the message said (§4.1).
 */

// ------------------------------------------------------------- what a message can say

/**
 * The fields a template may drop into a sentence.
 *
 * A short list on purpose. Every placeholder is a promise that the value will
 * be there and will read like English in the middle of a sentence, and most of
 * what a lead carries — a rating, a Place ID, a website — fails one or both.
 */
export const MERGE_FIELDS = [
  { token: "name", label: "Business name", example: "Glow Beauty Studio" },
  { token: "area", label: "Area or locality", example: "Indirapuram" },
  { token: "city", label: "City", example: "Ghaziabad" },
  { token: "type", label: "What it is filed under", example: "Beauty parlour" }
] as const;

export type MergeField = (typeof MERGE_FIELDS)[number]["token"];

/** What a template writes `{{name}}` as, and what the renderer looks for. */
const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;

/**
 * The lead fields a message is allowed to reach into.
 *
 * Structural typing rather than `SalesLeadRecord`, so a search result that has
 * not been saved yet renders exactly as the saved row will. The preview on the
 * search screen would otherwise be a different code path from the message that
 * eventually goes out, which is the kind of difference nobody notices until a
 * customer is looking at it.
 */
export type Addressable = {
  name?: string;
  area?: string;
  city?: string;
  type?: string;
  phone?: string;
};

/**
 * What `{{area}}` becomes when Google never published one.
 *
 * A third of small listings have no sublocality, and the naive substitution
 * turns "parlours in {{area}}" into "parlours in ", which reads as a bug to the
 * person receiving it. Falling back along the chain area → city → a general
 * phrase keeps the sentence grammatical whatever is missing, and "your area" is
 * chosen over dropping the clause because a half-sentence is harder to write a
 * template around than a slightly generic one.
 */
function value(lead: Addressable, token: string): string {
  const area = lead.area?.trim();
  const city = lead.city?.trim();

  switch (token) {
    case "name": return lead.name?.trim() || "there";
    case "area": return area || city || "your area";
    case "city": return city || area || "your city";
    case "type": return lead.type?.trim().toLowerCase() || "business";
    default: return "";
  }
}

/**
 * Fills a template in for one lead.
 *
 * An unknown placeholder is left standing rather than blanked. A template
 * saying `{{owner}}` is a mistake somebody made, and the person about to press
 * send is the last one who can catch it — swallowing it silently would send a
 * sentence with a hole in it, whereas the braces are visible in the preview and
 * read as obviously wrong.
 */
export function render(template: string, lead: Addressable): string {
  return template.replace(PLACEHOLDER, (whole, token: string) =>
    (MERGE_FIELDS as readonly { token: string }[]).some(field => field.token === token)
      ? value(lead, token)
      : whole
  );
}

/** Placeholders a template uses that nothing will ever fill in. */
export function unknownFields(template: string): string[] {
  const known = new Set<string>(MERGE_FIELDS.map(field => field.token));
  const found = [...template.matchAll(PLACEHOLDER)].map(match => match[1]);
  return [...new Set(found.filter(token => !known.has(token)))];
}

// ------------------------------------------------------------------- the link

/**
 * WhatsApp truncates a prefilled message somewhere north of this, and a
 * parlour owner reading it between customers stops well before that anyway.
 */
export const MAX_MESSAGE_LENGTH = 900;

/**
 * The tap.
 *
 * `wa.me` rather than `api.whatsapp.com` because it is the one WhatsApp
 * documents for deep links, and on a phone it hands off to the installed app
 * instead of a browser tab that then has to hand off again.
 *
 * Returns null when the number cannot be made sense of, which is the same
 * answer `whatsappUrl` gives and for the same reason: a lead whose phone field
 * holds "call the shop" should be visibly unsendable rather than produce a link
 * that dies after the tap.
 */
export function whatsappSendUrl(phone: string | null | undefined, message: string): string | null {
  const number = whatsappNumber(phone);
  if (!number) return null;
  const text = message.trim();
  return text
    ? `https://wa.me/${number}?text=${encodeURIComponent(text)}`
    : `https://wa.me/${number}`;
}

/** One lead, ready to be tapped — or ready to explain why it cannot be. */
export type QueueEntry = {
  lead: Addressable & { _id: string };
  message: string;
  url: string | null;
};

/**
 * Turns a chosen list and a chosen template into the thing the screen walks
 * through.
 *
 * Leads with no usable number are kept in the queue rather than filtered out.
 * They are a real category — the parlour whose listing gives a landline — and
 * dropping them silently would leave somebody wondering why a list of forty
 * became a queue of thirty-one. The screen shows them with the reason and a
 * skip, which is also where the number gets corrected.
 */
export function buildQueue<T extends Addressable & { _id: string }>(
  leads: readonly T[],
  template: string
): QueueEntry[] {
  return leads.map(lead => {
    const message = render(template, lead);
    return { lead, message, url: whatsappSendUrl(lead.phone, message) };
  });
}

// ------------------------------------------------------------------- storing one

const bodyField = z.string().trim()
  .min(10, "A message needs something in it")
  .max(MAX_MESSAGE_LENGTH, `Keep it under ${MAX_MESSAGE_LENGTH} characters — WhatsApp cuts off long prefills`);

export const templateSchema = z.object({
  name: z.string().trim()
    .min(2, "Give the template a name you will recognise later")
    .max(80, "A name is a short label, like Parlour intro"),
  body: bodyField,
  /**
   * What this template is for saying, mirroring the lead's own free-text type.
   * Optional, because the first template somebody writes is "the message" and
   * making them categorise it before they have a second one is friction for
   * nothing.
   */
  audience: z.string().trim().max(60).optional()
});

export type TemplateInput = z.infer<typeof templateSchema>;

export const templateUpdateSchema = z.object({
  name: templateSchema.shape.name.optional(),
  body: bodyField.optional(),
  audience: z.string().trim().max(60).optional()
}).refine(input => Object.keys(input).length > 0, "Nothing to change");

/** What the queue reports back once somebody has tapped through a lead. */
export const contactedSchema = z.object({
  /** Kept so the audit trail can answer "what did we actually say to them". */
  message: z.string().trim().max(MAX_MESSAGE_LENGTH).optional(),
  templateId: z.string().trim().max(40).optional()
});

/**
 * Whether tapping send should move the status on.
 *
 * Only `New` advances. A lead somebody has already spoken to and marked
 * `Interested` is further along than "we sent them something", and letting a
 * follow-up message drag it backwards would quietly undo the one piece of
 * information on the row that was earned by a human (§4.10). `Not interested`
 * holds for the same reason — if they are being messaged again that is a
 * decision, not a state change.
 */
export const advancesOnSend = (status: string) => status === "New";

/** A template as the collection stores it, in the shape a screen reads. */
export type TemplateRecord = {
  _id: string;
  name: string;
  body: string;
  audience?: string;
  createdAt?: string;
  updatedAt?: string;
};
