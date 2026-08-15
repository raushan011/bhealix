import { amount, httpJson, IntegrationError } from "./http";
import type { AdhocOrderPayload, CourierOption, PickupLocation } from "./fulfilment";

/**
 * Reading delivery status out of Shiprocket — and, since orders are booked from
 * here rather than in their panel, writing to it as well.
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

// ------------------------------------------------------------------- booking
/*
 * Everything below writes rather than reads, and each call is one step of the
 * job somebody currently does in Shiprocket's own panel:
 *
 *   pickupLocations   where the parcel leaves from — the warehouses on the account
 *   createOrder       the order itself, when Shiprocket has never seen it
 *   serviceability    which couriers reach that pin code, at what price
 *   assignAwb         the airway bill, which is the parcel becoming real
 *   schedulePickup    asking the courier to come and collect it
 *   documentUrl       the invoice and the label, as printable PDFs
 *
 * Each one is separate because each one fails separately and for its own
 * reasons, and a batch that stops at the third order needs to say which step it
 * stopped on.
 */

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

/** The company's own addresses. The booking call names one of these, by nickname. */
export async function pickupLocations(token: string): Promise<PickupLocation[]> {
  const { data } = await httpJson<{ data?: { shipping_address?: {
    pickup_location?: string; address?: string; city?: string; state?: string; pin_code?: string | number; phone?: string | number;
  }[] } }>({
    service: "Shiprocket", url: `${BASE}/settings/company/pickup`, headers: auth(token)
  });

  return (data.data?.shipping_address ?? [])
    .map(row => ({
      name: String(row.pickup_location ?? "").trim(),
      address: row.address ?? undefined,
      city: row.city ?? undefined,
      state: row.state ?? undefined,
      pinCode: row.pin_code != null ? String(row.pin_code) : undefined,
      phone: row.phone != null ? String(row.phone) : undefined
    }))
    .filter(location => location.name);
}

export type BookedOrder = { shiprocketOrderId: string; shipmentId: string; status?: string };

/**
 * The order, typed into Shiprocket.
 *
 * "Adhoc" is their word for an order that belongs to no connected channel, which
 * is exactly what this is: the shop's orders reach this CRM through the Shopify
 * Admin API or a checkout export, and the parcel is being raised here. It is
 * filed under the shop's own order name, so the delivery sync can find it again.
 *
 * Shiprocket answers 200 with a `status_code` of its own when it declines — a
 * duplicate order id, most often, which is a shop whose channel already pushed
 * the order across. That is why the caller looks for an existing order first.
 */
export async function createOrder(token: string, payload: AdhocOrderPayload): Promise<BookedOrder> {
  const { data } = await httpJson<{ order_id?: number | string; shipment_id?: number | string; status?: string; message?: string }>({
    service: "Shiprocket", url: `${BASE}/orders/create/adhoc`, method: "POST", headers: auth(token), body: payload
  });

  const shiprocketOrderId = String(data.order_id ?? "");
  const shipmentId = String(data.shipment_id ?? "");
  if (!shiprocketOrderId || !shipmentId) {
    throw new IntegrationError("Shiprocket", data.message
      ? `Shiprocket would not book this order: ${data.message}`
      : "Shiprocket accepted the booking but returned no shipment for it.");
  }
  return { shiprocketOrderId, shipmentId, status: data.status ?? undefined };
}

type ServiceableCourier = {
  courier_company_id?: number | string;
  courier_name?: string;
  rate?: number | string;
  freight_charge?: number | string;
  cod_charges?: number | string;
  etd?: string;
  estimated_delivery_days?: number | string;
  rating?: number | string;
  is_surface?: boolean;
  cod?: number | boolean;
};

/**
 * Which couriers can carry this parcel to this pin code, and for how much.
 *
 * The COD flag genuinely changes the answer rather than only the price: some
 * couriers will not carry cash for some pin codes at all, so asking without it
 * would offer a courier that refuses the parcel at the counter.
 */
export async function serviceability(token: string, query: {
  pickupPincode: string;
  deliveryPincode: string;
  weight: number;
  cod: boolean;
  declaredValue: number;
}): Promise<CourierOption[]> {
  const search = new URLSearchParams({
    pickup_postcode: query.pickupPincode,
    delivery_postcode: query.deliveryPincode,
    weight: String(query.weight),
    cod: query.cod ? "1" : "0",
    declared_value: String(Math.max(1, Math.round(query.declaredValue)))
  });

  const { data } = await httpJson<{ data?: {
    available_courier_companies?: ServiceableCourier[];
    recommended_courier_company_id?: number | string;
  } }>({
    service: "Shiprocket", url: `${BASE}/courier/serviceability/?${search}`, headers: auth(token)
  });

  return toCourierOptions(data.data);
}

/**
 * Shiprocket's courier list in the shape a person chooses from. Exported for its
 * own test, because the money on it is the money the company pays for freight.
 */
export function toCourierOptions(payload: {
  available_courier_companies?: ServiceableCourier[];
  recommended_courier_company_id?: number | string;
} | undefined): CourierOption[] {
  const recommended = String(payload?.recommended_courier_company_id ?? "");

  return (payload?.available_courier_companies ?? [])
    .map(courier => {
      const id = Number(courier.courier_company_id);
      const days = Number(courier.estimated_delivery_days);
      return {
        id,
        name: String(courier.courier_name ?? "").trim() || `Courier ${id}`,
        // `rate` is already the all-in figure; the two parts are only summed for
        // the accounts that answer with them separately.
        rate: Math.round(amount(courier.rate) || amount(courier.freight_charge) + amount(courier.cod_charges)),
        days: Number.isFinite(days) && days > 0 ? days : undefined,
        etd: courier.etd ?? undefined,
        rating: amount(courier.rating) || undefined,
        surface: courier.is_surface === true,
        cod: Boolean(courier.cod),
        recommended: recommended !== "" && String(courier.courier_company_id) === recommended
      };
    })
    .filter(courier => Number.isFinite(courier.id) && courier.id > 0);
}

export type AwbAssignment = { awb: string; courier: string; courierId?: number };

/**
 * The airway bill, which is the moment the parcel exists as far as the courier
 * is concerned.
 *
 * Shiprocket answers 200 with `awb_assign_status: 0` when it refuses — no
 * capacity, a pin code the courier dropped this morning, an account with no
 * balance. The refusal reads well and is passed through verbatim, because
 * "Shiprocket refused the airway bill: insufficient wallet balance" is the
 * sentence that gets somebody to top up the account.
 */
export async function assignAwb(token: string, shipmentId: string, courierId: number): Promise<AwbAssignment> {
  const { data } = await httpJson<{
    awb_assign_status?: number;
    response?: { data?: { awb_code?: string | number; courier_name?: string; courier_company_id?: number | string }; message?: string };
    message?: string;
  }>({
    service: "Shiprocket", url: `${BASE}/courier/assign/awb`, method: "POST", headers: auth(token),
    body: { shipment_id: Number(shipmentId), courier_id: courierId }
  });

  const assigned = data.response?.data;
  const awb = String(assigned?.awb_code ?? "").trim();
  if (!awb) {
    const why = data.response?.message ?? data.message ?? "Shiprocket returned no airway bill.";
    throw new IntegrationError("Shiprocket", `Shiprocket refused the airway bill: ${why}`);
  }

  return {
    awb,
    courier: String(assigned?.courier_name ?? "").trim(),
    courierId: assigned?.courier_company_id != null ? Number(assigned.courier_company_id) : courierId
  };
}

export type PickupBooking = { scheduledAt?: Date; token?: string };

/**
 * Asking the courier to come and collect.
 *
 * Optional on purpose, and off by default. A warehouse that has a standing daily
 * pickup does not want forty pickup requests raised against it, and Shiprocket
 * treats a duplicate request for the same day as an error rather than a no-op.
 */
export async function schedulePickup(token: string, shipmentId: string): Promise<PickupBooking> {
  const { data } = await httpJson<{ pickup_status?: number; response?: { pickup_scheduled_date?: string; pickup_token_number?: string | number } }>({
    service: "Shiprocket", url: `${BASE}/courier/generate/pickup`, method: "POST", headers: auth(token),
    body: { shipment_id: [Number(shipmentId)] }
  });

  return {
    scheduledAt: parseDate(data.response?.pickup_scheduled_date) ?? new Date(),
    token: data.response?.pickup_token_number != null ? String(data.response.pickup_token_number) : undefined
  };
}

/**
 * Where the printable invoice or shipping label lives.
 *
 * Both come back as a URL to a PDF on Shiprocket's storage rather than as bytes,
 * and both accept a list — which is what makes "print thirty invoices" one call
 * and one file rather than thirty of each. The URL is short-lived and is never
 * handed to a browser; the route fetches it and streams the bytes back itself.
 *
 * They key on different things, and getting them the wrong way round produces an
 * empty PDF rather than an error: an invoice belongs to the **order**, a label
 * belongs to the **shipment**.
 */
export async function documentUrl(token: string, kind: "invoice" | "label", ids: string[]): Promise<string> {
  const numeric = ids.map(id => Number(id)).filter(id => Number.isFinite(id) && id > 0);
  if (!numeric.length) throw new IntegrationError("Shiprocket", "None of these orders have been booked with Shiprocket yet.");

  const { data } = await httpJson<{ invoice_url?: string; label_url?: string; not_created?: unknown[]; message?: string }>(
    kind === "invoice"
      ? { service: "Shiprocket", url: `${BASE}/orders/print/invoice`, method: "POST", headers: auth(token), body: { ids: numeric } }
      : { service: "Shiprocket", url: `${BASE}/courier/generate/label`, method: "POST", headers: auth(token), body: { shipment_id: numeric } }
  );

  const url = String((kind === "invoice" ? data.invoice_url : data.label_url) ?? "").trim();
  if (!url) {
    throw new IntegrationError("Shiprocket", data.message
      ? `Shiprocket would not produce the ${kind}: ${data.message}`
      : `Shiprocket produced no ${kind} for ${numeric.length === 1 ? "this order" : "these orders"}. A label needs an airway bill assigned first.`);
  }
  return url;
}

/**
 * The PDF itself.
 *
 * Fetched server-side and streamed on, rather than redirecting the browser to
 * Shiprocket's storage: the link carries an access signature, it expires, and a
 * file the user downloads should be named after their order rather than after
 * somebody's bucket key.
 */
export async function fetchDocument(url: string): Promise<Uint8Array> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new IntegrationError("Shiprocket", `Shiprocket's file store refused the download (${response.status}).`);
    return new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    if (error instanceof IntegrationError) throw error;
    throw new IntegrationError("Shiprocket", "Could not download the file Shiprocket prepared. Try again in a moment.");
  } finally {
    clearTimeout(timer);
  }
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
