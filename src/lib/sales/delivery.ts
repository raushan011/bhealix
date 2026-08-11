import type { DeliveryState } from "./constants";

/**
 * Shiprocket's status vocabulary, reduced to the six outcomes that decide
 * whether anybody is paid.
 *
 * Shiprocket reports something like forty statuses and adds to them, so this
 * matches on the words rather than on an exhaustive list — an unrecognised
 * status lands on `Awaiting`, which pays nobody, rather than on a guess.
 *
 * **Order matters.** "RTO DELIVERED" and "RETURN DELIVERED" both contain the
 * word delivered and neither is a sale; the parcel came back. Checking those
 * first is the whole reason this is a sequence of rules and not a lookup table.
 *
 * Pure, and tested, because a mis-read status is a wrong payment.
 */

const has = (value: string, ...words: string[]) => words.some(word => value.includes(word));

/**
 * Codes, for the statuses where Shiprocket's own numbering is clearer than its
 * wording. Consulted only when the text says nothing useful.
 */
const BY_CODE: Record<number, DeliveryState> = {
  7: "Delivered",
  8: "Cancelled",
  9: "RTO",
  10: "RTO",
  12: "Lost",
  14: "RTO",
  16: "Cancelled",
  17: "In transit",
  18: "In transit",
  21: "Undelivered",
  24: "Lost",
  25: "Lost",
  42: "In transit",
  44: "Lost",
  45: "Cancelled",
  46: "RTO",
  49: "Returned",
  50: "Returned",
  51: "Returned"
};

/** What the courier is telling us, in our own words. */
export function deliveryStateFrom(status: string | null | undefined, statusCode?: number | null): DeliveryState {
  const value = (status ?? "").trim().toUpperCase().replace(/[_-]+/g, " ");

  if (value) {
    if (value.includes("RTO")) return "RTO";
    if (value.includes("RETURN")) return "Returned";
    if (has(value, "CANCEL")) return "Cancelled";
    if (has(value, "LOST", "DESTROYED", "DISPOSED", "DAMAGED")) return "Lost";

    // A partial delivery is not a delivered order and not a failed one. It pays
    // nobody until somebody looks at it and sets the state by hand — which is
    // what the manual override on the order is for.
    if (value.includes("PARTIAL")) return "Undelivered";
    if (value.includes("UNDELIVERED")) return "Undelivered";

    /*
     * The negations come before the words they negate, because both contain
     * them. "UNFULFILLED" contains "FULFILLED"; checking the shorter first
     * would read an order that has not even been picked as delivered, and pay
     * commission on it.
     */
    if (value.includes("UNFULFILLED")) return "Awaiting";
    if (value.includes("DELIVERED")) return "Delivered";

    /*
     * Fulfilled is *dispatched*, not arrived — it is Shopify's word for "a
     * label exists". Treating it as a delivery would pay on every parcel the
     * moment it left the warehouse, which is the exact opposite of the rule
     * this whole feature is built around. Delivery is confirmed by the courier,
     * through the Shiprocket sync, and by nothing else.
     */
    if (value.includes("FULFILLED")) return "In transit";

    if (has(value, "TRANSIT", "OUT FOR DELIVERY", "SHIPPED", "PICKED UP", "DESTINATION HUB", "DISPATCHED", "DELAYED")) {
      return "In transit";
    }
  }

  return (statusCode != null && BY_CODE[statusCode]) || "Awaiting";
}

/** Whether a state was reached by the parcel arriving, as opposed to still being on its way. */
export const isSettled = (state: DeliveryState) => state !== "Awaiting" && state !== "In transit";

/** Badge colours, so a status means the same thing on every screen. */
export function deliveryTone(state: DeliveryState): "success" | "info" | "warn" | "danger" | "neutral" {
  switch (state) {
    case "Delivered": return "success";
    case "In transit": return "info";
    case "Undelivered": return "warn";
    case "RTO": case "Returned": case "Cancelled": case "Lost": return "danger";
    default: return "neutral";
  }
}

export function commissionTone(status: string): "success" | "info" | "warn" | "danger" | "neutral" {
  switch (status) {
    case "Paid": return "success";
    case "Payable": return "info";
    case "Maturing": case "In payout": return "warn";
    case "Void": return "danger";
    default: return "neutral";
  }
}
