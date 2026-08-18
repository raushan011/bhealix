import { describe, expect, it } from "vitest";
import { trackOrder, trackingHeadline, trackingProgress, type TrackableOrder } from "./tracking";

/**
 * The order, told as a sequence.
 *
 * Tested because a rep reads this instead of reading the badges, and a step
 * marked "waiting" on a parcel that came back three weeks ago is somebody
 * expecting a payment that is never coming.
 */

const order = (patch: Partial<TrackableOrder> = {}): TrackableOrder => ({
  placedAt: "2026-08-01T10:00:00.000Z",
  financialStatus: "paid",
  paymentMethod: "Prepaid",
  delivery: { state: "Awaiting" },
  commission: { status: "Pending", amount: 0 },
  ...patch
});

const stateOf = (steps: ReturnType<typeof trackOrder>, key: string) =>
  steps.find(step => step.key === key)?.state;

describe("trackOrder", () => {
  it("always tells the whole story, however it ended", () => {
    const steps = trackOrder(order());
    expect(steps.map(step => step.key)).toEqual(["placed", "paid", "shipped", "delivered", "paid-out"]);
  });

  it("puts a fresh order at the dispatch step", () => {
    const steps = trackOrder(order());
    expect(stateOf(steps, "placed")).toBe("done");
    expect(stateOf(steps, "paid")).toBe("done");
    expect(stateOf(steps, "shipped")).toBe("current");
    expect(stateOf(steps, "delivered")).toBe("waiting");
  });

  it("counts a parcel with a waybill as dispatched even before the courier reports", () => {
    const steps = trackOrder(order({ shipment: { awb: "ABC123", courier: "Delhivery" } }));
    expect(stateOf(steps, "shipped")).toBe("done");
    expect(stateOf(steps, "delivered")).toBe("current");
    expect(steps.find(step => step.key === "shipped")?.detail).toContain("Delhivery");
  });

  it("walks a delivered order through to the money, which is owed the moment it lands", () => {
    const steps = trackOrder(order({
      delivery: { state: "Delivered", at: "2026-08-05T10:00:00.000Z" },
      commission: { status: "Payable", amount: 720 }
    }));
    expect(stateOf(steps, "delivered")).toBe("done");
    expect(stateOf(steps, "paid-out")).toBe("current");
    expect(steps.find(step => step.key === "paid-out")?.label).toBe("Ready to be paid");
  });

  it("marks everything behind a paid order as done, and says how it was paid", () => {
    const steps = trackOrder(order({
      delivery: { state: "Delivered" },
      commission: { status: "Paid", amount: 720, payment: { paidAt: "2026-08-06T10:00:00.000Z", mode: "UPI", reference: "UTR123" } }
    }));
    expect(steps.every(step => step.state === "done")).toBe(true);
    expect(trackingProgress(steps)).toBe(100);
    const paid = steps.find(step => step.key === "paid-out");
    expect(paid?.at).toBe("2026-08-06T10:00:00.000Z");
    expect(paid?.detail).toContain("UPI");
    expect(paid?.detail).toContain("UTR123");
  });

  /*
   * The case that matters most. A parcel that came back must never leave a step
   * saying "waiting" — that is a rep waiting for money that will not arrive.
   */
  it("closes off every remaining step when the parcel comes back", () => {
    const steps = trackOrder(order({
      delivery: { state: "RTO" },
      commission: { status: "Void", amount: 0, reason: "The parcel was returned to sender." }
    }));
    expect(stateOf(steps, "delivered")).toBe("failed");
    expect(stateOf(steps, "paid-out")).toBe("failed");
    expect(steps.some(step => step.state === "waiting")).toBe(false);
  });

  it("does the same for a cancelled order, which never even shipped", () => {
    const steps = trackOrder(order({
      financialStatus: "voided",
      delivery: { state: "Cancelled" },
      commission: { status: "Void", amount: 0 }
    }));
    expect(stateOf(steps, "paid")).toBe("failed");
    expect(stateOf(steps, "shipped")).toBe("failed");
    expect(steps.some(step => step.state === "waiting")).toBe(false);
  });

  it("names cash on delivery rather than calling it an unpaid order", () => {
    const steps = trackOrder(order({ financialStatus: "pending", paymentMethod: "Cash on Delivery" }));
    expect(steps.find(step => step.key === "paid")?.label).toBe("Pays on delivery");
  });

  it("treats a refunded order as one where the money did arrive", () => {
    const steps = trackOrder(order({ financialStatus: "partially_refunded" }));
    expect(stateOf(steps, "paid")).toBe("done");
  });
});

describe("trackingHeadline", () => {
  it("says what happened, from the rep's side of it", () => {
    expect(trackingHeadline(order())).toContain("not been dispatched");
    expect(trackingHeadline(order({ delivery: { state: "In transit" } }))).toBe("On its way to the customer.");
    expect(trackingHeadline(order({
      delivery: { state: "Delivered" },
      commission: { status: "Paid", amount: 720 }
    }))).toBe("Paid to you.");
  });

  it("does not promise anything on a parcel that came back", () => {
    expect(trackingHeadline(order({ delivery: { state: "RTO" }, commission: { status: "Void", amount: 0 } })))
      .toContain("came back");
    expect(trackingHeadline(order({ delivery: { state: "Cancelled" }, commission: { status: "Void", amount: 0 } })))
      .toContain("cancelled");
  });

  it("prefers the recorded reason when a commission was voided", () => {
    expect(trackingHeadline(order({
      delivery: { state: "Delivered" },
      commission: { status: "Void", amount: 0, reason: "The whole order was refunded." }
    }))).toBe("The whole order was refunded.");
  });
});

describe("trackingProgress", () => {
  it("counts only what is behind us", () => {
    expect(trackingProgress(trackOrder(order()))).toBe(40);
  });
});
