import { createHmac, timingSafeEqual } from "node:crypto";
import { httpJson } from "./http";
import { assertShopDomain, type ShopifyConfig } from "./shopify";

/**
 * Shopify telling us about an order the moment it happens.
 *
 * The nightly pass already keeps things correct, but "correct by tomorrow
 * morning" is not what anybody means by automatic: a rep who sold something at
 * noon should see it at noon. Webhooks close that gap, and the scheduled sync
 * stays as the safety net — a webhook that is missed while the site is
 * redeploying is picked up by the next pull rather than lost.
 *
 * The three topics are the three ways an order changes what somebody is owed:
 * it arrives, it is edited or refunded, or it is cancelled.
 */
export const WEBHOOK_TOPICS = ["orders/create", "orders/updated", "orders/cancelled"] as const;
export type WebhookTopic = (typeof WEBHOOK_TOPICS)[number];

export const WEBHOOK_PATH = "/api/sales/shopify/webhook";

/**
 * Whether Shopify really sent this.
 *
 * Signed over the **raw request body**, base64, with the app's client secret.
 * It has to be the bytes as they arrived — parsing the JSON and re-serialising
 * it changes key order and whitespace, and the signature no longer matches.
 * That is why the route reads `request.text()` and only then parses.
 *
 * This is the whole of the authentication on that route: it is public, because
 * Shopify has no session, so anything that fails here is refused.
 */
export function verifyWebhook(rawBody: string, header: string | null, secret: string): boolean {
  if (!header || !secret) return false;

  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  let given: Buffer;
  try {
    given = Buffer.from(header, "base64");
  } catch {
    return false;
  }

  return given.length === expected.length && timingSafeEqual(given, expected);
}

type RegisteredWebhook = { id?: number | string; topic?: string; address?: string };

const url = (config: ShopifyConfig, path: string) =>
  `https://${assertShopDomain(config.domain)}/admin/api/${config.apiVersion}/${path}`;

const headers = (config: ShopifyConfig) => ({ "X-Shopify-Access-Token": config.accessToken });

/**
 * Subscribes to the three topics, and does not double-subscribe.
 *
 * Shopify keeps one subscription per topic *per address*, so re-registering
 * after a redeploy would quietly accumulate duplicates and deliver every order
 * three times. Existing subscriptions to our own address are left alone; ones
 * pointing at a stale address are replaced, which is what happens when the site
 * moves.
 */
export async function registerWebhooks(config: ShopifyConfig, address: string): Promise<{ created: WebhookTopic[]; kept: WebhookTopic[]; failed: { topic: WebhookTopic; reason: string }[] }> {
  const existing = await httpJson<{ webhooks?: RegisteredWebhook[] }>({
    service: "Shopify", url: url(config, "webhooks.json?limit=250"), headers: headers(config)
  }).then(response => response.data.webhooks ?? []).catch(() => []);

  const created: WebhookTopic[] = [];
  const kept: WebhookTopic[] = [];
  const failed: { topic: WebhookTopic; reason: string }[] = [];

  for (const topic of WEBHOOK_TOPICS) {
    const already = existing.find(hook => hook.topic === topic && hook.address === address);
    if (already) { kept.push(topic); continue; }

    // A subscription on the same topic pointing somewhere else is ours from a
    // previous address; removing it keeps the list honest.
    const stale = existing.find(hook => hook.topic === topic && hook.address?.includes(WEBHOOK_PATH));
    if (stale?.id) {
      await httpJson({ service: "Shopify", url: url(config, `webhooks/${stale.id}.json`), method: "POST", headers: { ...headers(config), "X-HTTP-Method-Override": "DELETE" } })
        .catch(() => undefined);
    }

    try {
      await httpJson({
        service: "Shopify",
        url: url(config, "webhooks.json"),
        method: "POST",
        headers: headers(config),
        body: { webhook: { topic, address, format: "json" } }
      });
      created.push(topic);
    } catch (error) {
      failed.push({ topic, reason: error instanceof Error ? error.message : "could not subscribe" });
    }
  }

  return { created, kept, failed };
}

/** What Shopify is currently sending us, for the screen to report. */
export async function listWebhooks(config: ShopifyConfig): Promise<{ topic: string; address: string }[]> {
  const { data } = await httpJson<{ webhooks?: RegisteredWebhook[] }>({
    service: "Shopify", url: url(config, "webhooks.json?limit=250"), headers: headers(config)
  });
  return (data.webhooks ?? [])
    .filter(hook => hook.address?.includes(WEBHOOK_PATH))
    .map(hook => ({ topic: String(hook.topic ?? ""), address: String(hook.address ?? "") }));
}
