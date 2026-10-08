import { describe, expect, it } from "vitest";
import type { ShiprocketListedOrder } from "@/lib/sales/shiprocket";
import { findReplacement, similarNames } from "./shipment-match";

// The case that prompted this: #1802 placed at 6:57 pm, re-made and shipped as #1806 at 7:26 pm.
const order = { placedAt: "2026-10-04T13:27:00Z", totals: { paid: 399 }, customer: { name: "Aasma", phone: "7668813186", pinCode: "245101" } };
const row = (over: Partial<ShiprocketListedOrder>): ShiprocketListedOrder => ({
  shiprocketOrderId: "1", channelOrderId: "1806", customerName: "Asma .", customerPhone: "7668813186",
  pinCode: "245101", createdAt: "04 Oct 2026, 07:26 PM", total: 399, status: "DELIVERED", awb: "77979356070", ...over
});

describe("findReplacement", () => {
  it("finds the re-made copy by phone", () => {
    expect(findReplacement(order, [row({})])?.channelOrderId).toBe("1806");
  });

  it("finds it by pin code, amount and name when Shiprocket masks the phone", () => {
    expect(findReplacement(order, [row({ customerPhone: undefined })])?.awb).toBe("77979356070");
  });

  it("does not take a different customer at the same pin code", () => {
    expect(findReplacement(order, [row({ customerPhone: undefined, customerName: "Rahul" })])).toBeNull();
  });

  it("does not take an unshipped, cancelled, claimed or much later order", () => {
    expect(findReplacement(order, [row({ awb: undefined })])).toBeNull();
    expect(findReplacement(order, [row({ status: "CANCELED" })])).toBeNull();
    expect(findReplacement(order, [row({})], new Set(["77979356070"]))).toBeNull();
    expect(findReplacement(order, [row({ createdAt: "2026-11-20 10:00:00" })])).toBeNull();
    expect(findReplacement(order, [row({ createdAt: "2026-09-20 10:00:00" })])).toBeNull();
  });

  it("wants more than the phone alone", () => {
    expect(findReplacement(order, [row({ total: 899, pinCode: "110001" })])).toBeNull();
  });

  it("takes the copy made soonest after the order", () => {
    const later = row({ channelOrderId: "1810", awb: "999", createdAt: "2026-10-07 10:00:00" });
    expect(findReplacement(order, [later, row({})])?.channelOrderId).toBe("1806");
  });
});

describe("similarNames", () => {
  it("allows a doubled letter or a single slip", () => {
    expect(similarNames("Aasma", "Asma .")).toBe(true);
    expect(similarNames("Priyanka Sharma", "priyanaka")).toBe(true);
    expect(similarNames("Ravi", "Rani")).toBe(false);
    expect(similarNames("Asma", "")).toBe(false);
  });
});
