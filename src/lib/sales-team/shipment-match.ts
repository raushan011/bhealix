import type { ShiprocketListedOrder } from "@/lib/sales/shiprocket";

/**
 * Finding the parcel the office actually shipped for a team order, when it was
 * not shipped under the order's own number.
 *
 * It happens: the office re-makes an order in the shop to correct an address
 * (Shopify's "Duplicate"), ships the copy — #1806 — and leaves the executive's
 * #1802 sitting in Shiprocket as NEW for ever. Matched by number, the CRM then
 * says "not shipped yet" about a parcel the customer already has.
 *
 * So, when the order's own number finds nothing shipped, Shiprocket's list is
 * read for a shipped order to the same customer, shortly after this one was
 * placed. Pure, and tested, because a wrong match moves somebody's incentive.
 *
 * What counts as the same customer, strongest first:
 * - the same phone number (last ten digits), with the same amount or pin code;
 * - when Shiprocket masks the phone, as it often does: the same pin code, the
 *   same amount, and a name that is the same allowing a typo (Asma / Aasma).
 */

export type MatchableOrder = {
  placedAt: Date | string;
  totals?: { paid?: number | null } | null;
  customer?: { name?: string | null; phone?: string | null; pinCode?: string | null } | null;
};

/** How long after an order is placed its re-made copy may still be found. */
export const REPLACEMENT_WINDOW_DAYS = 15;
const DAY_MS = 86_400_000;

const digits = (value: unknown) => String(value ?? "").replace(/\D/g, "");
const phoneOf = (value: unknown) => {
  const all = digits(value);
  return all.length >= 10 ? all.slice(-10) : "";
};

/** Letters only, lower case, doubled letters collapsed — "Aasma ." and "Asma" both become "asma". */
const nameKey = (value: unknown) =>
  String(value ?? "").toLowerCase().split(/\s+/).map(word => word.replace(/[^a-z]/g, "").replace(/(.)\1+/g, "$1")).filter(Boolean);

function distance(left: string, right: string): number {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= right.length; j++) {
      const kept = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (left[i - 1] === right[j - 1] ? 0 : 1));
      previous = kept;
    }
  }
  return row[right.length];
}

/** The same first name, allowing one slip of the keyboard on a name of five letters or more. */
export function similarNames(left: unknown, right: unknown): boolean {
  const [a] = nameKey(left);
  const [b] = nameKey(right);
  if (!a || !b) return false;
  if (a === b) return true;
  return Math.min(a.length, b.length) >= 5 && distance(a, b) <= 1;
}

/** Shiprocket's `04 Oct 2026, 07:26 PM` or `2026-10-04 19:26:00`, read as a date. */
function dateOf(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(/^\d{4}-\d{2}-\d{2} /.test(value) ? value.replace(" ", "T") : value.replace(",", ""));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const CLOSED = /cancel/i;

/**
 * The shipped Shiprocket order that is this team order's parcel, or null.
 * `claimed` holds the airway bills already on another team order, which can
 * therefore not be this one's.
 */
export function findReplacement(order: MatchableOrder, listing: ShiprocketListedOrder[], claimed: Set<string> = new Set()): ShiprocketListedOrder | null {
  const placed = new Date(order.placedAt).getTime();
  const phone = phoneOf(order.customer?.phone);
  const pin = digits(order.customer?.pinCode);
  const total = Math.round(Number(order.totals?.paid ?? NaN));

  const candidates = listing.filter(row => {
    if (!row.awb || claimed.has(row.awb) || CLOSED.test(row.status ?? "")) return false;
    const created = dateOf(row.createdAt)?.getTime();
    // A day either side of "placed", for the clock of one system against the other.
    if (created == null || created < placed - DAY_MS || created > placed + REPLACEMENT_WINDOW_DAYS * DAY_MS) return false;

    const samePhone = Boolean(phone) && phoneOf(row.customerPhone) === phone;
    const samePin = Boolean(pin) && digits(row.pinCode) === pin;
    const sameTotal = Number.isFinite(total) && row.total != null && Math.round(row.total) === total;
    if (samePhone) return sameTotal || samePin;
    return samePin && sameTotal && similarNames(order.customer?.name, row.customerName);
  });

  // The copy made soonest after the order is the one made for it.
  return candidates.sort((left, right) => (dateOf(left.createdAt)?.getTime() ?? 0) - (dateOf(right.createdAt)?.getTime() ?? 0))[0] ?? null;
}
