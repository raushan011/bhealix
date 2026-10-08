import { timingSafeEqual } from "node:crypto";

/**
 * Shiprocket telling us a parcel moved, the moment it does.
 *
 * Shiprocket posts one of these for every scan on every parcel of the account
 * (Settings → API → Webhooks), with the token set there in `x-api-key`. The
 * opened-screen refresh and the nightly pass stay as the safety net — a post
 * missed while the site redeploys is picked up by the next one.
 *
 * Shiprocket refuses a webhook URL containing "shiprocket", "kartrocket", "sr"
 * or "kr", which is why the route is `/api/courier/updates`.
 */
export const COURIER_WEBHOOK_PATH = "/api/courier/updates";

/** Whether the post carries the token configured in Shiprocket. Constant time, and false when none is configured. */
export function verifyCourierToken(given: string | null, secret: string | undefined): boolean {
  if (!given || !secret) return false;
  const left = Buffer.from(given);
  const right = Buffer.from(secret);
  return left.length === right.length && timingSafeEqual(left, right);
}

export type CourierUpdate = {
  awb?: string;
  /** The channel's order id — the shop's number for a Shopify order. */
  channelOrderId?: string;
  shiprocketOrderId?: string;
  courier?: string;
  status?: string;
  statusCode?: number;
  deliveredAt?: Date;
  /** `yyyy-mm-dd hh:mm:ss`, the courier's expected delivery. */
  expectedDelivery?: string;
};

const text = (value: unknown) => (value == null ? undefined : String(value).trim() || undefined);
const number = (value: unknown) => (value == null || value === "" || !Number.isFinite(Number(value)) ? undefined : Number(value));

/** `23 05 2023 11:43:52` — Shiprocket's webhook clock, Indian time. */
function webhookTime(value: unknown): Date | undefined {
  const match = /^(\d{2})\s+(\d{2})\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/.exec(String(value ?? "").trim());
  if (!match) return undefined;
  const [, day, month, year, hour, minute, second] = match;
  const parsed = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}+05:30`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/** What one post says, in the order's own field names. Null when it names no parcel. */
export function readCourierUpdate(body: unknown): CourierUpdate | null {
  if (!body || typeof body !== "object") return null;
  const post = body as Record<string, unknown>;
  const awb = text(post.awb);
  const channelOrderId = text(post.order_id);
  if (!awb && !channelOrderId) return null;

  const status = text(post.shipment_status) ?? text(post.current_status);
  const delivered = /delivered/i.test(status ?? "") && !/rto|return|undelivered/i.test(status ?? "");
  return {
    awb,
    channelOrderId,
    shiprocketOrderId: text(post.sr_order_id),
    courier: text(post.courier_name),
    status,
    statusCode: number(post.shipment_status_id) ?? number(post.current_status_id),
    deliveredAt: delivered ? webhookTime(post.current_timestamp) ?? new Date() : undefined,
    expectedDelivery: text(post.etd)
  };
}
