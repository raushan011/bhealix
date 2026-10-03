import type { TeamPaymentMode } from "./orders";

/**
 * How likely a parcel is to come back undelivered (RTO), worked out before it is
 * sent.
 *
 * An RTO costs twice: freight out and freight back, and the incentive with it.
 * The executive is the one person who can do something about it while the
 * customer is still on the line — ask for an advance, confirm the address, or
 * switch them to prepaid — so the score is shown on the order form as they type,
 * and kept on the order afterwards.
 *
 * Pure and tested. The history it reads (how this pin code and this phone number
 * have done before) is gathered by the server from the company's own orders; no
 * guess about a customer is made from anything but what actually happened to
 * their parcels.
 */

export const RISK_LEVELS = ["Low", "Medium", "High"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

/** Settled parcels only: delivered, or came back. Anything still moving says nothing yet. */
export type History = { delivered: number; returned: number };

export type RiskInput = {
  paymentMode: TeamPaymentMode;
  total: number;
  advance?: number;
  address: { address1?: string; address2?: string; city?: string; pinCode?: string };
  /** This customer's own past parcels, matched on phone. */
  phone?: History | null;
  /** Every parcel the company has sent to this pin code. */
  pin?: History | null;
  /** What Shiprocket said about the pin code, when it was asked. */
  serviceability?: { deliverable: boolean; cod: boolean } | null;
};

export type RiskResult = { score: number; level: RiskLevel; reasons: string[]; advice?: string };

const rate = (history?: History | null) => {
  const settled = (history?.delivered ?? 0) + (history?.returned ?? 0);
  return settled ? (history?.returned ?? 0) / settled : null;
};

/**
 * A score out of 100 and the reasons behind it, in the order they matter.
 *
 * The weights are deliberately simple and readable — each reason on screen is
 * one line of this function — because an executive told "high risk" with no
 * reason has nothing to say to the customer, and one told "this pin code returned
 * 4 of its last 6 parcels" does.
 */
export function assessRto(input: RiskInput): RiskResult {
  let score = 0;
  const reasons: string[] = [];
  const add = (points: number, reason: string) => { score += points; reasons.push(reason); };

  // How the customer pays is the strongest single signal.
  if (input.paymentMode === "COD") add(30, "Cash on delivery — nothing paid up front.");
  else if (input.paymentMode === "Partial") {
    const share = input.total > 0 ? (input.advance ?? 0) / input.total : 0;
    if (share < 0.1) add(15, "The advance is less than a tenth of the order.");
    else add(5, "Part paid — the balance is collected at the door.");
  }

  // Their own record outweighs everything else, in either direction.
  const own = rate(input.phone);
  const ownSettled = (input.phone?.delivered ?? 0) + (input.phone?.returned ?? 0);
  if (own !== null && (input.phone?.returned ?? 0) > 0) {
    add(own >= 0.5 ? 35 : 20, `This customer has returned ${input.phone?.returned} of ${ownSettled} past parcel${ownSettled === 1 ? "" : "s"}.`);
  } else if (ownSettled >= 1) {
    score -= 15;
    reasons.push(`Repeat customer — ${input.phone?.delivered} parcel${input.phone?.delivered === 1 ? "" : "s"} delivered before, none returned.`);
  } else if (input.paymentMode !== "Prepaid") {
    add(5, "First order from this phone number.");
  }

  // The area, once there is enough of a record to mean anything.
  const pinRate = rate(input.pin);
  const pinSettled = (input.pin?.delivered ?? 0) + (input.pin?.returned ?? 0);
  if (pinRate !== null && pinSettled >= 3) {
    if (pinRate >= 0.4) add(20, `This pin code returned ${input.pin?.returned} of its last ${pinSettled} parcels.`);
    else if (pinRate >= 0.2) add(10, `This pin code returns more than usual (${input.pin?.returned} of ${pinSettled}).`);
  }

  // Value at stake.
  if (input.paymentMode !== "Prepaid" && input.total >= 3000) add(10, "A high-value order collected in cash.");

  // An address a courier will struggle to find.
  const street = `${input.address.address1 ?? ""} ${input.address.address2 ?? ""}`.trim();
  if (street.length < 15) add(10, "The address is very short — add the house number, street and a landmark.");
  else if (!/\d/.test(street)) add(5, "The address has no house or flat number.");

  // What the courier network says.
  if (input.serviceability) {
    if (!input.serviceability.deliverable) add(40, "No courier delivers to this pin code.");
    else if (!input.serviceability.cod && input.paymentMode !== "Prepaid") add(25, "Couriers here do not collect cash — ask for prepaid.");
  }

  score = Math.max(0, Math.min(100, score));
  const level: RiskLevel = score >= 55 ? "High" : score >= 30 ? "Medium" : "Low";
  const advice = level === "High"
    ? (input.paymentMode === "Prepaid" ? "Confirm the address and phone with the customer before booking." : "Ask for an advance or prepaid, and confirm the address before booking.")
    : level === "Medium" ? "Confirm the address and the delivery day with the customer." : undefined;

  return { score, level, reasons, advice };
}

export function riskTone(level: string): "success" | "warn" | "danger" | "neutral" {
  switch (level) {
    case "Low": return "success";
    case "Medium": return "warn";
    case "High": return "danger";
    default: return "neutral";
  }
}

// ------------------------------------------------------------- delivery day

const text = (value: unknown) => String(value ?? "").toUpperCase();

/** The courier has the parcel on the van today. */
export const isOutForDelivery = (status: unknown) => /OUT[\s_-]*FOR[\s_-]*DELIVERY/.test(text(status));

/**
 * A delivery attempt failed and the courier is waiting to be told what to do —
 * Shiprocket's "NDR". These are the parcels a phone call today turns back into a
 * delivery, and the ones that become RTOs by default if nobody acts.
 */
export const needsAction = (status: unknown, state?: string) =>
  state === "Undelivered" || /UNDELIVERED|NDR|DELIVERY[\s_-]*FAILED|FAILED[\s_-]*DELIVERY|CUSTOMER[\s_-]*NOT/.test(text(status));

/** Whether an expected delivery date falls on this calendar day (`yyyy-mm-dd`). */
export const dueOn = (expected: string | Date | null | undefined, day: string) => {
  if (!expected) return false;
  const value = typeof expected === "string" ? expected : expected.toISOString();
  return value.slice(0, 10) === day;
};

// --------------------------------------------------------------- follow-ups

export type FollowUpBucket = "Overdue" | "Today" | "Upcoming";

/** Where a follow-up date sits against today, for the dashboard's grouping. Days are `yyyy-mm-dd`. */
export function followUpBucket(day: string, today: string): FollowUpBucket {
  if (day < today) return "Overdue";
  return day === today ? "Today" : "Upcoming";
}
