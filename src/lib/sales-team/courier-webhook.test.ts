import { describe, expect, it } from "vitest";
import { readCourierUpdate, verifyCourierToken } from "./courier-webhook";

describe("verifyCourierToken", () => {
  it("accepts only the configured token", () => {
    expect(verifyCourierToken("abc123", "abc123")).toBe(true);
    expect(verifyCourierToken("abc124", "abc123")).toBe(false);
    expect(verifyCourierToken("abc", "abc123")).toBe(false);
    expect(verifyCourierToken(null, "abc123")).toBe(false);
    expect(verifyCourierToken("abc123", undefined)).toBe(false);
  });
});

describe("readCourierUpdate", () => {
  it("reads Shiprocket's tracking post", () => {
    const update = readCourierUpdate({
      awb: 77979356070, courier_name: "Blue Dart Surface", current_status: "DELIVERED", current_status_id: 7,
      shipment_status: "DELIVERED", shipment_status_id: 7, current_timestamp: "06 10 2026 14:05:00",
      order_id: "1806", sr_order_id: 912345, etd: "2026-10-06 23:59:59"
    });
    expect(update).toMatchObject({
      awb: "77979356070", channelOrderId: "1806", shiprocketOrderId: "912345", courier: "Blue Dart Surface",
      status: "DELIVERED", statusCode: 7, expectedDelivery: "2026-10-06 23:59:59"
    });
    expect(update?.deliveredAt?.toISOString()).toBe("2026-10-06T08:35:00.000Z");
  });

  it("does not read a return as a delivery", () => {
    expect(readCourierUpdate({ awb: "1", shipment_status: "RTO DELIVERED", current_timestamp: "06 10 2026 14:05:00" })?.deliveredAt).toBeUndefined();
  });

  it("ignores a post that names no parcel", () => {
    expect(readCourierUpdate({ current_status: "IN TRANSIT" })).toBeNull();
    expect(readCourierUpdate("nope")).toBeNull();
  });
});
