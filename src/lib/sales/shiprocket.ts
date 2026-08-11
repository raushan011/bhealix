import { httpJson, IntegrationError } from "./http";

/**
 * Reading delivery status out of Shiprocket.
 *
 * Two things about this API shape the code:
 *
 * 1. **The token is a login, not a key.** `POST /auth/login` with the API user's
 *    email and password returns a bearer token good for ten days. Logging in on
 *    every sync would work and would also be rude, so the token is cached in
 *    settings and refreshed a day before it lapses.
 *
 * 2. **Orders are joined by `channel_order_id`.** Shiprocket stores whatever the
 *    channel gave it, and for Shopify that is sometimes `1042`, sometimes
 *    `#1042` and sometimes the numeric order id — it depends how the store was
 *    connected, and Fastrr's checkout is a third path again. Rather than betting
 *    on one, `matchKeysFor` below produces every form an order could be filed
 *    under and the sync tries all of them.
 */

const BASE = "https://apiv2.shiprocket.in/v1/external";

export type ShiprocketConfig = { email: string; password: string };

/** Nine days, so a token is replaced before the tenth-day expiry can bite mid-sync. */
const TOKEN_LIFE_MS = 9 * 86_400_000;

export async function login({ email, password }: ShiprocketConfig): Promise<{ token: string; expiresAt: Date }> {
  if (!email || !password) throw new IntegrationError("Shiprocket", "Enter the Shiprocket API user's email and password.");

  const { data } = await httpJson<{ token?: string }>({
    service: "Shiprocket", url: `${BASE}/auth/login`, method: "POST", body: { email, password }
  });

  if (!data.token) throw new IntegrationError("Shiprocket", "Shiprocket accepted the request but returned no token. Check that this is an API user, created under Settings → API.");
  return { token: data.token, expiresAt: new Date(Date.now() + TOKEN_LIFE_MS) };
}

// ------------------------------------------------------------- the wire shape

type ShiprocketShipment = { id?: number | string; awb?: string | number | null; courier?: string | null; courier_name?: string | null; delivered_date?: string | null };

type ShiprocketOrder = {
  id?: number | string;
  channel_order_id?: string | number | null;
  status?: string | null;
  status_code?: number | null;
  delivered_date?: string | null;
  /** An array when there are shipments, and an empty object when there are none. */
  shipments?: ShiprocketShipment[] | Record<string, never> | null;
  awb_data?: { awb?: string | number | null; courier?: string | null } | null;
};

export type ShipmentUpdate = {
  /** What Shiprocket believes the channel calls this order. */
  channelOrderId: string;
  shiprocketOrderId: string;
  shipmentId?: string;
  awb?: string;
  courier?: string;
  status?: string;
  statusCode?: number;
  deliveredAt?: Date;
};

/**
 * Shiprocket writes timestamps as `2026-08-01 14:20:00` with no zone. Read as
 * local — the account is Indian, the courier is Indian, and inventing a UTC
 * offset would move a delivery across midnight and with it the day a commission
 * matures.
 */
function parseDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value.trim().replace(" ", "T"));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

const shipmentsOf = (order: ShiprocketOrder): ShiprocketShipment[] =>
  Array.isArray(order.shipments) ? order.shipments : [];

function toUpdate(order: ShiprocketOrder): ShipmentUpdate | null {
  const channelOrderId = String(order.channel_order_id ?? "").trim();
  if (!channelOrderId) return null;

  const shipment = shipmentsOf(order)[0];
  const awb = shipment?.awb ?? order.awb_data?.awb;

  return {
    channelOrderId,
    shiprocketOrderId: String(order.id ?? ""),
    shipmentId: shipment?.id != null ? String(shipment.id) : undefined,
    awb: awb != null && String(awb) ? String(awb) : undefined,
    courier: shipment?.courier_name ?? shipment?.courier ?? order.awb_data?.courier ?? undefined,
    status: order.status ?? undefined,
    statusCode: order.status_code ?? undefined,
    deliveredAt: parseDate(order.delivered_date ?? shipment?.delivered_date)
  };
}

/**
 * Every order Shiprocket holds for the window, as status updates.
 *
 * The window is on the *order* date, so it has to reach back far enough to
 * cover anything still in transit — a parcel placed five weeks ago and delivered
 * today is exactly the case that pays somebody.
 */
export async function fetchShipments(token: string, from: string, to: string, maxPages = 40): Promise<ShipmentUpdate[]> {
  const updates: ShipmentUpdate[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const url = `${BASE}/orders?${new URLSearchParams({ from, to, per_page: "100", page: String(page) })}`;
    const { data } = await httpJson<{ data?: ShiprocketOrder[]; meta?: { pagination?: { total_pages?: number } } }>({
      service: "Shiprocket", url, headers: { authorization: `Bearer ${token}` }
    });

    const rows = data.data ?? [];
    for (const row of rows) {
      const update = toUpdate(row);
      if (update) updates.push(update);
    }

    const totalPages = data.meta?.pagination?.total_pages ?? 1;
    if (!rows.length || page >= totalPages) break;
  }

  return updates;
}

/** One order, for the refresh button beside it. */
export async function fetchShipmentFor(token: string, channelOrderId: string): Promise<ShipmentUpdate | null> {
  const url = `${BASE}/orders?${new URLSearchParams({ filter_by: "channel_order_id", filter: channelOrderId, per_page: "10" })}`;
  const { data } = await httpJson<{ data?: ShiprocketOrder[] }>({
    service: "Shiprocket", url, headers: { authorization: `Bearer ${token}` }
  });
  for (const row of data.data ?? []) {
    const update = toUpdate(row);
    if (update) return update;
  }
  return null;
}

/**
 * Every form an order could be filed under on Shiprocket's side, so a join can
 * be tried against all of them.
 *
 * `"#1042"`, `"1042"` and the numeric Shopify id are all in use in the wild,
 * and which one arrives depends on how the store was connected. Matching on a
 * set costs nothing and is the difference between a delivery being seen and a
 * rep not being paid.
 */
export function matchKeysFor(order: { name?: string | null; orderNumber?: number | null; shopifyOrderId?: string | null }): string[] {
  const keys = new Set<string>();
  const add = (value: unknown) => {
    const text = String(value ?? "").trim();
    if (text) keys.add(text.toUpperCase());
  };

  add(order.name);
  add(String(order.name ?? "").replace(/^#/, ""));
  add(order.orderNumber);
  add(order.shopifyOrderId);
  return [...keys];
}

/** The same normalisation on the key an update arrived under. */
export const matchKey = (value: string) => value.trim().toUpperCase();
