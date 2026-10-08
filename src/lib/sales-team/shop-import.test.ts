import { describe, expect, it } from "vitest";
import { mapOrder, type ShopifyOrder } from "@/lib/sales/shopify";
import {
  copyOfCrmOrder, crmRefOf, executiveFromTags, paymentOfShopOrder, teamOrderFromShiprocket, teamOrderFromShopify
} from "./shop-import";

const shop = (over: Partial<ShopifyOrder> = {}): ShopifyOrder => ({
  id: 9001, name: "#1806", order_number: 1806, created_at: "2026-10-04T19:26:00+05:30", financial_status: "pending",
  total_price: "399.00", payment_gateway_names: ["Cash on Delivery (COD)"],
  shipping_address: { name: "Asma", address1: "Purana Bahar Market", city: "Hapur", province: "Uttar Pradesh", zip: "245101", phone: "7668813186" },
  line_items: [{ id: 1, title: "Testing Kit (trial pack)", quantity: 1, price: "399.00" }],
  tags: "Sales team, exec-BHX-SE-02, Adarsh",
  ...over
} as ShopifyOrder);

const crm = [{ _id: "a", ref: "BHX-SE-00001", shopifyOrderId: "8001", placedAt: new Date("2026-10-04T18:57:00+05:30"), totals: { paid: 399 }, customer: { phone: "+91 76688 13186" } }];

describe("copyOfCrmOrder", () => {
  it("knows a copy by the CRM number in its note", () => {
    const raw = shop({ note_attributes: [{ name: "CRM order", value: "BHX-SE-00001" }], tags: "" });
    expect(crmRefOf(raw)).toBe("BHX-SE-00001");
    expect(copyOfCrmOrder(raw, mapOrder(raw), crm)?._id).toBe("a");
  });

  it("knows a tagged copy by phone and amount shortly after", () => {
    const raw = shop();
    expect(copyOfCrmOrder(raw, mapOrder(raw), crm)?._id).toBe("a");
  });

  it("does not take the CRM order itself, an untagged website order, or a different amount", () => {
    expect(copyOfCrmOrder(shop({ id: 8001 }), mapOrder(shop({ id: 8001 })), crm)).toBeNull();
    expect(copyOfCrmOrder(shop({ tags: "" }), mapOrder(shop({ tags: "" })), crm)).toBeNull();
    const dearer = shop({ line_items: [{ id: 1, title: "Kit", quantity: 2, price: "399.00" }] } as Partial<ShopifyOrder>);
    expect(copyOfCrmOrder(dearer, mapOrder(dearer), crm)).toBeNull();
  });
});

describe("executiveFromTags", () => {
  it("finds the executive by their exec tag, whatever the case", () => {
    const byTag = new Map([["exec-bhx-se-02", "Adarsh"]]);
    expect(executiveFromTags(shop(), byTag)).toBe("Adarsh");
    expect(executiveFromTags(shop({ tags: "Sales team" }), byTag)).toBeUndefined();
  });
});

describe("imported orders", () => {
  it("bring a shop order in as COD, with no incentive", () => {
    const raw = shop();
    const order = teamOrderFromShopify(raw, mapOrder(raw));
    expect(order).toMatchObject({ name: "#1806", origin: "Shopify", paymentMode: "COD", collectAmount: 399, incentive: { enabled: false, status: "Not eligible" } });
    expect(order.items[0]).toMatchObject({ title: "Testing Kit (trial pack)", quantity: 1, price: 399 });
    expect("executive" in order).toBe(false);
  });

  it("read a paid order as prepaid with nothing to collect", () => {
    const raw = shop({ financial_status: "paid", payment_gateway_names: ["Razorpay"] });
    expect(paymentOfShopOrder(raw, mapOrder(raw))).toMatchObject({ paymentMode: "Prepaid", collectAmount: 0 });
  });

  it("bring a Shiprocket-only order in with its parcel", () => {
    const order = teamOrderFromShiprocket({
      shiprocketOrderId: "77", channelOrderId: "4292017550", customerName: "Abhi", createdAt: "06 Oct 2026, 01:51 AM",
      total: 349, paymentMethod: "cod", status: "DELIVERED", awb: "77981204851", courier: "Blue Dart Surface"
    });
    expect(order).toMatchObject({
      name: "4292017550", origin: "Shiprocket", paymentMode: "COD", collectAmount: 349,
      shipment: { awb: "77981204851" }, delivery: { state: "Delivered" }, incentive: { enabled: false }
    });
  });
});
