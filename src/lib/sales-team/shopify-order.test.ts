import { describe, expect, it } from "vitest";
import { buildShopifyOrder, canWriteOrders, executiveTag, shopifyAdminOrderUrl, TEAM_DISCOUNT_CODE, type ShopifyOrderInput } from "./shopify-order";

const input = (over: Partial<ShopifyOrderInput> = {}): ShopifyOrderInput => ({
  ref: "BHX-SE-00042",
  executive: { name: "Priya Nair", employeeId: "BHX-SE-01" },
  customer: { name: "Ravi Kumar Singh", phone: "9876543210", address1: "12 MG Road", city: "Patna", state: "Bihar", pinCode: "800001" },
  lines: [{ variantId: "4455", title: "Kit", quantity: 1, price: 1500 }, { title: "Custom serum", quantity: 2, price: 250 }],
  discount: 100,
  total: 1900,
  paymentMode: "COD",
  advance: 0,
  ...over
});

const order = (over: Partial<ShopifyOrderInput> = {}) => buildShopifyOrder(input(over)).order;

describe("buildShopifyOrder", () => {
  it("tags every order with the team and the executive, so the shop can be filtered per person", () => {
    expect(order().tags).toBe("Sales team, exec-BHX-SE-01, Priya Nair");
    expect(order().note_attributes).toEqual(expect.arrayContaining([
      { name: "Sales executive", value: "Priya Nair" },
      { name: "CRM order", value: "BHX-SE-00042" }
    ]));
  });

  it("names a variant where there is one, so stock comes off the shop, and types the rest", () => {
    expect(order().line_items).toEqual([
      { variant_id: 4455, quantity: 1, price: "1500.00" },
      { title: "Custom serum", sku: undefined, quantity: 2, price: "250.00", requires_shipping: true, taxable: true }
    ]);
    expect(order().inventory_behaviour).toBe("decrement_obeying_policy");
  });

  it("files the discount under the team's own code, which attribution never claims", () => {
    expect(order().discount_codes).toEqual([{ code: TEAM_DISCOUNT_CODE, amount: "100.00", type: "fixed_amount" }]);
    expect(order({ discount: 0 }).discount_codes).toBeUndefined();
    expect(TEAM_DISCOUNT_CODE).not.toMatch(/\d$/);
  });

  it("records COD as owed at the door", () => {
    expect(order().financial_status).toBe("pending");
    expect(order().transactions).toEqual([{ kind: "sale", status: "pending", amount: "1900.00", gateway: "Cash on Delivery (COD)" }]);
  });

  it("records prepaid as paid", () => {
    const paid = order({ paymentMode: "Prepaid", advance: 1900 });
    expect(paid.financial_status).toBe("paid");
    expect(paid.transactions).toEqual([{ kind: "sale", status: "success", amount: "1900.00", gateway: "manual" }]);
  });

  it("records a part payment as the advance received and the balance at the door", () => {
    const part = order({ paymentMode: "Partial", advance: 300 });
    expect(part.financial_status).toBe("partially_paid");
    expect(part.transactions).toEqual([
      { kind: "sale", status: "success", amount: "300.00", gateway: "manual" },
      { kind: "sale", status: "pending", amount: "1600.00", gateway: "Cash on Delivery (COD)" }
    ]);
  });

  it("sends no customer object, which Shopify refuses for a repeat buyer's phone", () => {
    expect("customer" in order()).toBe(false);
    expect(order().shipping_address).toMatchObject({ first_name: "Ravi", last_name: "Kumar Singh", phone: "9876543210", province: "Bihar", zip: "800001", country: "India" });
  });
});

describe("helpers", () => {
  it("makes a tag Shopify accepts out of any employee ID", () => {
    expect(executiveTag("BHX SE/01")).toBe("exec-BHX-SE-01");
  });

  it("reads whether order writing was granted", () => {
    expect(canWriteOrders("read_orders,write_orders")).toBe(true);
    expect(canWriteOrders("read_orders, read_products")).toBe(false);
    expect(canWriteOrders(undefined)).toBe(false);
  });

  it("links to the order in the shop's admin", () => {
    expect(shopifyAdminOrderUrl("https://bhealix.myshopify.com/", "991")).toBe("https://bhealix.myshopify.com/admin/orders/991");
  });
});
