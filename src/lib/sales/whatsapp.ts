import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { httpJson, IntegrationError } from "./http";
import { cleanParameter, parameterCount, type MetaTemplate } from "./automation";

/**
 * Sending a WhatsApp message without anybody pressing send.
 *
 * The queue in `outreach.ts` opens WhatsApp with the text written and leaves
 * the last tap to a person, and the comment there explains why that is the only
 * version that survives on an ordinary WhatsApp number: bulk sending from a
 * phone is against the terms and is answered by banning the number.
 *
 * There is exactly one way to send automatically and keep the number, and it
 * is Meta's own **WhatsApp Business Cloud API** — a business number registered
 * with Meta, a permanent access token, and messages that are *templates Meta
 * has approved* rather than free text. The rules that come with it are the
 * shape of everything in this file:
 *
 * - A business may open a conversation with somebody who has never written to
 *   it only with an approved template. Free text is refused until they reply,
 *   and then only for twenty-four hours. So an automation rule names a Meta
 *   template, and this file fills in its `{{1}}`, `{{2}}` slots from the lead.
 * - A new number may open a limited number of conversations a day, and Meta
 *   raises the limit as the number earns a reputation. So there is a daily cap,
 *   and the queue waits rather than blasting through it.
 * - Delivery, reading and replies arrive afterwards, by webhook. So the same
 *   file parses what Meta posts back and checks its signature.
 *
 * Only this module knows the shape of Meta's API. Everything else works with a
 * `WhatsAppConfig` and the plain records below.
 */

// ---------------------------------------------------------------- the config

export type WhatsAppConfig = {
  /** The Cloud API's own id for the sending number — not the number itself. */
  phoneNumberId: string;
  /** The WhatsApp Business Account the number belongs to; templates live here. */
  businessAccountId: string;
  /** A permanent System User token from Meta Business Settings. */
  accessToken: string;
  apiVersion?: string;
};

export const DEFAULT_GRAPH_VERSION = "v21.0";

const graph = (config: WhatsAppConfig, path: string) =>
  `https://graph.facebook.com/${config.apiVersion || DEFAULT_GRAPH_VERSION}/${path}`;

const auth = (config: WhatsAppConfig) => ({ authorization: `Bearer ${config.accessToken}` });

/** The complete configuration, or the reason it is not. */
export function whatsappMissing(config: Partial<WhatsAppConfig> | null | undefined): string | null {
  if (!config?.phoneNumberId) return "Add the Phone number ID from Meta's WhatsApp API setup page.";
  if (!config.businessAccountId) return "Add the WhatsApp Business Account ID — it is next to the phone number id on the same page.";
  if (!config.accessToken) return "Add a permanent access token. A temporary one from the API setup page expires in a day.";
  return null;
}

// -------------------------------------------------------------- the template

type RawTemplate = {
  name?: string;
  language?: string;
  status?: string;
  category?: string;
  components?: { type?: string; text?: string }[];
};

/**
 * Every template on the account, approved or not, so the screen can say why
 * one cannot be picked yet rather than hiding it.
 */
export async function listTemplates(config: WhatsAppConfig): Promise<MetaTemplate[]> {
  const url = graph(config, `${config.businessAccountId}/message_templates?fields=name,language,status,category,components&limit=100`);
  const { data } = await httpJson<{ data?: RawTemplate[] }>({ service: "WhatsApp", url, headers: auth(config) });

  return (data.data ?? []).flatMap(raw => {
    if (!raw.name || !raw.language) return [];
    const body = raw.components?.find(component => component.type?.toUpperCase() === "BODY")?.text ?? "";
    return [{
      name: raw.name,
      language: raw.language,
      status: raw.status ?? "UNKNOWN",
      category: raw.category,
      body,
      parameterCount: parameterCount(body)
    }];
  });
}

/** What the number is called and whether Meta still trusts it — the "Test connection" answer. */
export async function verifyNumber(config: WhatsAppConfig): Promise<{ displayNumber: string; name: string; quality: string; tier?: string }> {
  const url = graph(config, `${config.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,messaging_limit_tier`);
  const { data } = await httpJson<{
    display_phone_number?: string; verified_name?: string; quality_rating?: string; messaging_limit_tier?: string;
  }>({ service: "WhatsApp", url, headers: auth(config) });

  return {
    displayNumber: data.display_phone_number ?? "",
    name: data.verified_name ?? "",
    quality: data.quality_rating ?? "UNKNOWN",
    tier: data.messaging_limit_tier
  };
}

// ------------------------------------------------------------------ sending

export type SendResult = { messageId: string; to: string };

/**
 * One template message to one number.
 *
 * `to` is the international number without a plus — the same digits
 * `whatsappNumber` produces. Meta answers with its own id for the message,
 * which is the key every later status and reply is matched back on.
 */
export async function sendTemplate(config: WhatsAppConfig, to: string, template: { name: string; language: string }, values: readonly string[]): Promise<SendResult> {
  const parameters = values.map(value => ({ type: "text", text: cleanParameter(value) }));
  const body = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: template.name,
      language: { code: template.language },
      ...(parameters.length ? { components: [{ type: "body", parameters }] } : {})
    }
  };

  const { data } = await httpJson<{ messages?: { id?: string }[]; contacts?: { wa_id?: string }[] }>({
    service: "WhatsApp", url: graph(config, `${config.phoneNumberId}/messages`), method: "POST", headers: auth(config), body
  });

  const messageId = data.messages?.[0]?.id;
  if (!messageId) throw new IntegrationError("WhatsApp", "WhatsApp accepted the request but returned no message id.");
  return { messageId, to: data.contacts?.[0]?.wa_id ?? to };
}

/**
 * Whether a refusal is the number's fault or ours.
 *
 * Meta's error codes split cleanly: some mean *this recipient* cannot be
 * messaged (not on WhatsApp, has blocked the business, invalid number) and the
 * queue should move on; others mean the account itself is in trouble (bad
 * token, rate limit, template paused) and every further send this run would
 * fail the same way — carrying on would only turn one error into two hundred.
 */
export function stopsTheRun(error: unknown): boolean {
  if (!(error instanceof IntegrationError)) return false;
  // 401 and 403 are the token; 429 is the rate limit; a code 131047-style
  // recipient problem comes back as a 400 and is per-number.
  return error.status === 401 || error.status === 403 || error.status === 429 || error.status === 500 || error.status === 503;
}

// ----------------------------------------------------------------- webhooks

/**
 * Meta signs every webhook post over the raw bytes with the app secret.
 * Header shape is `sha256=<hex>`.
 */
export function verifySignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header || !appSecret) return false;
  const given = header.startsWith("sha256=") ? header.slice(7) : header;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  if (given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given, "utf8"), Buffer.from(expected, "utf8"));
}

/** A delivery report — Meta says what happened to a message it was handed. */
export type StatusEvent = {
  messageId: string;
  status: "sent" | "delivered" | "read" | "failed" | string;
  recipient: string;
  at: Date;
  error?: string;
};

/** Somebody wrote back. */
export type InboundEvent = {
  messageId: string;
  from: string;
  /** Their WhatsApp profile name — worth showing beside the number. */
  profileName?: string;
  type: string;
  text: string;
  at: Date;
  /** Which of our messages they tapped reply on, when WhatsApp says. */
  inReplyTo?: string;
};

const webhookSchema = z.object({
  object: z.string().optional(),
  entry: z.array(z.object({
    changes: z.array(z.object({
      field: z.string().optional(),
      value: z.object({
        metadata: z.object({ phone_number_id: z.string().optional() }).partial().optional(),
        contacts: z.array(z.object({ wa_id: z.string().optional(), profile: z.object({ name: z.string().optional() }).partial().optional() })).optional(),
        statuses: z.array(z.object({
          id: z.string(),
          status: z.string(),
          timestamp: z.string().optional(),
          recipient_id: z.string().optional(),
          errors: z.array(z.object({ code: z.union([z.number(), z.string()]).optional(), title: z.string().optional(), message: z.string().optional() })).optional()
        })).optional(),
        messages: z.array(z.object({
          id: z.string(),
          from: z.string(),
          timestamp: z.string().optional(),
          type: z.string().optional(),
          text: z.object({ body: z.string().optional() }).partial().optional(),
          button: z.object({ text: z.string().optional(), payload: z.string().optional() }).partial().optional(),
          interactive: z.object({
            button_reply: z.object({ title: z.string().optional() }).partial().optional(),
            list_reply: z.object({ title: z.string().optional() }).partial().optional()
          }).partial().optional(),
          context: z.object({ id: z.string().optional() }).partial().optional()
        })).optional()
      }).partial()
    })).default([])
  })).default([])
});

const stamp = (seconds: string | undefined) => {
  const parsed = Number(seconds);
  return Number.isFinite(parsed) && parsed > 0 ? new Date(parsed * 1000) : new Date();
};

/**
 * Everything worth keeping out of one webhook post.
 *
 * Tolerant on purpose. Meta posts a great deal this application does not care
 * about — template status changes, account alerts — and a strict parser would
 * turn each new one into a 500, which has Meta retry it for a day and then
 * pause the subscription. Anything unrecognised is simply not in the result.
 */
export function parseWebhook(payload: unknown, expectedPhoneNumberId?: string): { statuses: StatusEvent[]; inbound: InboundEvent[] } {
  const parsed = webhookSchema.safeParse(payload);
  const statuses: StatusEvent[] = [];
  const inbound: InboundEvent[] = [];
  if (!parsed.success) return { statuses, inbound };

  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      const value = change.value;
      // A webhook subscription is per app, and an app can serve several
      // numbers. Only this number's traffic is ours to record.
      if (expectedPhoneNumberId && value.metadata?.phone_number_id && value.metadata.phone_number_id !== expectedPhoneNumberId) continue;

      const names = new Map((value.contacts ?? []).map(contact => [contact.wa_id, contact.profile?.name]));

      for (const status of value.statuses ?? []) {
        const first = status.errors?.[0];
        statuses.push({
          messageId: status.id,
          status: status.status,
          recipient: status.recipient_id ?? "",
          at: stamp(status.timestamp),
          error: first ? [first.title, first.message, first.code !== undefined ? `(${first.code})` : ""].filter(Boolean).join(" ") : undefined
        });
      }

      for (const message of value.messages ?? []) {
        const type = message.type ?? "unknown";
        const text = message.text?.body
          ?? message.button?.text
          ?? message.interactive?.button_reply?.title
          ?? message.interactive?.list_reply?.title
          ?? "";
        inbound.push({
          messageId: message.id,
          from: message.from,
          profileName: names.get(message.from) ?? undefined,
          type,
          text: text || `[${type}]`,
          at: stamp(message.timestamp),
          inReplyTo: message.context?.id
        });
      }
    }
  }

  return { statuses, inbound };
}
