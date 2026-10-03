import { SalesOrder } from "@/models/Sales";
import { SalesTeamOrder } from "@/models/SalesTeam";
import { tenDigitPhone, type PickupLocation } from "@/lib/sales/fulfilment";
import { IntegrationError } from "@/lib/sales/http";
import { loadCredentials, shiprocketToken } from "@/lib/sales/settings";
import { pickupLocations, serviceability } from "@/lib/sales/shiprocket";
import { assessRto, type History, type RiskResult } from "./risk";
import type { TeamPaymentMode } from "./orders";
import { loadTeamSettings } from "./server";

/**
 * The two questions an executive asks before an order goes anywhere: can a
 * courier reach this address, and how likely is the parcel to come back.
 */

const RETURNED = ["RTO", "Returned"];

/**
 * How every parcel to this phone and this pin code has ended, across both the
 * sales team's orders and the shop's affiliate orders — the company's whole
 * delivery record, not one executive's slice of it. Only counts come back; no
 * other customer's details leave the database.
 */
export async function deliveryHistory(phone: string | undefined, pinCode: string | undefined): Promise<{ phone: History | null; pin: History | null }> {
  const digits = tenDigitPhone(phone);
  const pin = /^\d{6}$/.test(String(pinCode ?? "")) ? String(pinCode) : "";

  const count = async (match: Record<string, unknown>): Promise<History> => {
    const settled = { "delivery.state": { $in: ["Delivered", ...RETURNED] } };
    const [team, shop] = await Promise.all([
      SalesTeamOrder.aggregate([{ $match: { ...match, ...settled } }, { $group: { _id: "$delivery.state", n: { $sum: 1 } } }]),
      SalesOrder.aggregate([{ $match: { ...match, ...settled } }, { $group: { _id: "$delivery.state", n: { $sum: 1 } } }])
    ]) as [Array<{ _id: string; n: number }>, Array<{ _id: string; n: number }>];
    const rows = [...team, ...shop];
    return {
      delivered: rows.filter(row => row._id === "Delivered").reduce((sum, row) => sum + row.n, 0),
      returned: rows.filter(row => RETURNED.includes(row._id)).reduce((sum, row) => sum + row.n, 0)
    };
  };

  const [byPhone, byPin] = await Promise.all([
    digits ? count({ "customer.phone": { $regex: `${digits}$` } }) : Promise.resolve(null),
    pin ? count({ "customer.pinCode": pin }) : Promise.resolve(null)
  ]);
  return { phone: byPhone, pin: byPin };
}

/** The warehouse a team parcel leaves from: the one used last, else the first Shiprocket lists. */
let pickupCache: { at: number; locations: PickupLocation[] } | null = null;
async function defaultPickup(token: string): Promise<PickupLocation | null> {
  if (!pickupCache || Date.now() - pickupCache.at > 10 * 60_000) pickupCache = { at: Date.now(), locations: await pickupLocations(token) };
  const preferred = (await loadTeamSettings()).fulfilment?.pickupLocation;
  return pickupCache.locations.find(location => location.name === preferred && location.pinCode)
    ?? pickupCache.locations.find(location => location.pinCode) ?? null;
}

export type DeliveryCheck = {
  deliverable: boolean;
  cod: boolean;
  couriers: number;
  fastestDays?: number;
  cheapestRate?: number;
  etd?: string;
  from?: string;
  /** Set when Shiprocket could not be asked — the check is then unknown, not failed. */
  refusal?: string;
};

/**
 * Whether any courier can deliver to this pin code from the company's warehouse,
 * and whether it will collect cash there. Asked with the COD flag set, because
 * some couriers reach a pin code but will not carry cash to it.
 */
export async function checkDelivery(input: { pinCode: string; value: number; weight?: number }): Promise<DeliveryCheck> {
  const token = await shiprocketToken(await loadCredentials()).catch(() => null);
  if (!token) return { deliverable: false, cod: false, couriers: 0, refusal: "Shiprocket is not connected, so the address could not be checked." };

  try {
    const from = await defaultPickup(token);
    if (!from?.pinCode) return { deliverable: false, cod: false, couriers: 0, refusal: "Shiprocket has no pickup address with a pin code." };
    const ask = (cod: boolean) => serviceability(token, {
      pickupPincode: from.pinCode!, deliveryPincode: input.pinCode, weight: input.weight ?? 0.5, cod, declaredValue: input.value || 1
    });
    const [withCod, prepaid] = await Promise.all([ask(true), ask(false)]);
    const all = prepaid.length ? prepaid : withCod;
    const fastest = all.filter(courier => courier.days).sort((left, right) => (left.days ?? 99) - (right.days ?? 99))[0];
    return {
      deliverable: all.length > 0,
      cod: withCod.some(courier => courier.cod !== false),
      couriers: all.length,
      fastestDays: fastest?.days,
      etd: fastest?.etd,
      cheapestRate: all.length ? Math.min(...all.map(courier => courier.rate)) : undefined,
      from: from.name
    };
  } catch (error) {
    return { deliverable: false, cod: false, couriers: 0, refusal: error instanceof IntegrationError ? error.message : "Shiprocket did not answer." };
  }
}

/** The whole pre-order check: delivery, history, and the risk worked out from both. */
export async function preOrderCheck(input: {
  pinCode?: string; phone?: string; paymentMode: TeamPaymentMode; total: number; advance?: number;
  address1?: string; address2?: string; city?: string; askCourier?: boolean;
}): Promise<{ delivery: DeliveryCheck | null; risk: RiskResult; history: { phone: History | null; pin: History | null } }> {
  const pin = /^\d{6}$/.test(String(input.pinCode ?? "")) ? String(input.pinCode) : "";
  const [delivery, history] = await Promise.all([
    pin && input.askCourier !== false ? checkDelivery({ pinCode: pin, value: input.total }) : Promise.resolve(null),
    deliveryHistory(input.phone, pin)
  ]);
  const risk = assessRto({
    paymentMode: input.paymentMode,
    total: input.total,
    advance: input.advance,
    address: { address1: input.address1, address2: input.address2, city: input.city, pinCode: pin },
    phone: history.phone,
    pin: history.pin,
    serviceability: delivery && !delivery.refusal ? { deliverable: delivery.deliverable, cod: delivery.cod } : null
  });
  return { delivery, risk, history };
}
