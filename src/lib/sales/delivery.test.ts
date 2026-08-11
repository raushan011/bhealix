import { describe, expect, it } from "vitest";
import { deliveryStateFrom, isSettled } from "./delivery";

describe("deliveryStateFrom", () => {
  it("reads a plain delivery", () => {
    expect(deliveryStateFrom("DELIVERED")).toBe("Delivered");
    expect(deliveryStateFrom("delivered")).toBe("Delivered");
  });

  it("never reads a parcel that came back as a sale", () => {
    // Both of these contain the word "delivered" and neither earns anybody
    // anything — this is the case the whole module is ordered around.
    expect(deliveryStateFrom("RTO DELIVERED")).toBe("RTO");
    expect(deliveryStateFrom("RETURN DELIVERED")).toBe("Returned");
    expect(deliveryStateFrom("RTO_DELIVERED")).toBe("RTO");
  });

  it("groups the stages of a return to sender", () => {
    for (const status of ["RTO INITIATED", "RTO IN TRANSIT", "RTO ACKNOWLEDGED", "RTO OFD", "RTO NDR"]) {
      expect(deliveryStateFrom(status)).toBe("RTO");
    }
  });

  it("reads a cancellation, however it is spelled", () => {
    expect(deliveryStateFrom("CANCELED")).toBe("Cancelled");
    expect(deliveryStateFrom("CANCELLED")).toBe("Cancelled");
    expect(deliveryStateFrom("CANCELLATION REQUESTED")).toBe("Cancelled");
  });

  it("treats a parcel the courier no longer has as lost", () => {
    for (const status of ["LOST", "DAMAGED", "DESTROYED", "DISPOSED OFF"]) {
      expect(deliveryStateFrom(status)).toBe("Lost");
    }
  });

  it("holds a partial delivery back for somebody to look at", () => {
    expect(deliveryStateFrom("PARTIAL_DELIVERED")).toBe("Undelivered");
  });

  it("reads a failed attempt", () => {
    expect(deliveryStateFrom("UNDELIVERED")).toBe("Undelivered");
    expect(deliveryStateFrom("UNDELIVERED - 1ST ATTEMPT")).toBe("Undelivered");
  });

  it("reads a parcel on its way", () => {
    for (const status of ["IN TRANSIT", "OUT FOR DELIVERY", "SHIPPED", "PICKED UP", "REACHED AT DESTINATION HUB"]) {
      expect(deliveryStateFrom(status)).toBe("In transit");
    }
  });

  it("waits rather than guesses at a status it does not know", () => {
    expect(deliveryStateFrom("SOMETHING NEW SHIPROCKET ADDED")).toBe("Awaiting");
    expect(deliveryStateFrom("")).toBe("Awaiting");
    expect(deliveryStateFrom(null)).toBe("Awaiting");
    expect(deliveryStateFrom("NEW")).toBe("Awaiting");
    expect(deliveryStateFrom("PICKUP SCHEDULED")).toBe("Awaiting");
  });

  it("falls back to the status code when the wording says nothing", () => {
    expect(deliveryStateFrom("", 7)).toBe("Delivered");
    expect(deliveryStateFrom(null, 9)).toBe("RTO");
    expect(deliveryStateFrom("SOMETHING ODD", 21)).toBe("Undelivered");
    expect(deliveryStateFrom(null, 999)).toBe("Awaiting");
  });

  it("prefers the wording over the code, because the wording is what changed", () => {
    expect(deliveryStateFrom("RTO DELIVERED", 7)).toBe("RTO");
  });
});

describe("isSettled", () => {
  it("is true once the parcel has stopped moving", () => {
    expect(isSettled("Delivered")).toBe(true);
    expect(isSettled("RTO")).toBe(true);
    expect(isSettled("In transit")).toBe(false);
    expect(isSettled("Awaiting")).toBe(false);
  });
});
