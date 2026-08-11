import { describe, expect, it } from "vitest";
import { assertShopDomain, codesOn, mapOrder, normaliseDomain, type ShopifyOrder } from "./shopify";

describe("normaliseDomain", () => {
  it("takes the address as it stands", () => {
    expect(normaliseDomain("vapvrf-0z.myshopify.com")).toBe("vapvrf-0z.myshopify.com");
    expect(normaliseDomain("https://vapvrf-0z.myshopify.com/")).toBe("vapvrf-0z.myshopify.com");
    expect(normaliseDomain("  VAPVRF-0Z.MyShopify.com  ")).toBe("vapvrf-0z.myshopify.com");
  });

  it("reads the handle out of the admin URL, which is what people actually have open", () => {
    expect(normaliseDomain("admin.shopify.com/store/vapvrf-0z/")).toBe("vapvrf-0z.myshopify.com");
    expect(normaliseDomain("https://admin.shopify.com/store/vapvrf-0z/settings/apps")).toBe("vapvrf-0z.myshopify.com");
  });

  it("completes a bare store handle", () => {
    expect(normaliseDomain("vapvrf-0z")).toBe("vapvrf-0z.myshopify.com");
  });

  it("leaves a storefront domain alone rather than inventing a handle from it", () => {
    // There is no way to derive the handle from a custom domain, so this is
    // passed through to fail loudly at `assertShopDomain` instead.
    expect(normaliseDomain("https://www.bhealix.com/")).toBe("www.bhealix.com");
  });

  it("is empty for nothing", () => {
    expect(normaliseDomain("")).toBe("");
    expect(normaliseDomain("   ")).toBe("");
  });
});

describe("assertShopDomain", () => {
  it("accepts a myshopify address, however it arrived", () => {
    expect(assertShopDomain("admin.shopify.com/store/vapvrf-0z")).toBe("vapvrf-0z.myshopify.com");
    expect(assertShopDomain("vapvrf-0z")).toBe("vapvrf-0z.myshopify.com");
  });

  it("refuses a storefront domain, and says where to find the right one", () => {
    // The Admin API returns the shop's home page for these, so without this the
    // failure reads "answered with something that is not JSON".
    expect(() => assertShopDomain("www.bhealix.com")).toThrow(/myshopify\.com address/);
    expect(() => assertShopDomain("admin.shopify.com")).toThrow(/myshopify\.com address/);
  });

  it("refuses nothing at all", () => {
    expect(() => assertShopDomain("")).toThrow(/Enter the shop address/);
  });
});

/** One kit, ₹800 off by the rep's code, exactly as Shopify reports it. */
const order = (over: Partial<ShopifyOrder> = {}): ShopifyOrder => ({
  id: 5001,
  name: "#1042",
  order_number: 1042,
  created_at: "2026-08-01T10:00:00+05:30",
  financial_status: "paid",
  currency: "INR",
  discount_codes: [{ code: "RAUSHAN30" }],
  discount_applications: [{ type: "discount_code", code: "RAUSHAN30" }],
  line_items: [{
    id: 9001, sku: "KIT-PIG-01", title: "Skin pigmentation kit", quantity: 1, price: "2299.00",
    total_discount: "800.00",
    discount_allocations: [{ amount: "800.00", discount_application_index: 0 }]
  }],
  ...over
});

describe("codesOn", () => {
  it("lists every code on the order, upper-cased", () => {
    expect(codesOn(order({ discount_codes: [{ code: "raushan30" }, { code: "diwali25" }] })))
      .toEqual(["RAUSHAN30", "DIWALI25"]);
  });
});

describe("mapOrder", () => {
  it("attributes the line discount to the rep's own coupon", () => {
    const [line] = mapOrder(order(), "RAUSHAN30").items;
    expect(line.gross).toBe(2299);
    expect(line.couponDiscount).toBe(800);
    expect(line.otherDiscount).toBe(0);
  });

  it("counts somebody else's offer as somebody else's", () => {
    const mapped = mapOrder(order({
      discount_codes: [{ code: "RAUSHAN30" }, { code: "DIWALI25" }],
      discount_applications: [{ type: "discount_code", code: "RAUSHAN30" }, { type: "discount_code", code: "DIWALI25" }],
      line_items: [{
        id: 9001, title: "Skin pigmentation kit", quantity: 1, price: "2299.00",
        discount_allocations: [
          { amount: "800.00", discount_application_index: 0 },
          { amount: "99.00", discount_application_index: 1 }
        ]
      }]
    }), "RAUSHAN30");

    const [line] = mapped.items;
    expect(line.couponDiscount).toBe(800);
    expect(line.otherDiscount).toBe(99);
    expect(mapped.totals.paid).toBe(1400);
  });

  it("attributes nothing to a coupon that is not the rep's", () => {
    const [line] = mapOrder(order(), "PRIYA10").items;
    expect(line.couponDiscount).toBe(0);
    // The money still came off — it is simply nobody's commission base.
    expect(line.otherDiscount).toBe(800);
  });

  it("prices a multiple-quantity line off the unit price", () => {
    const [line] = mapOrder(order({
      line_items: [{ id: 9001, title: "Kit", quantity: 2, price: "2299.00", discount_allocations: [{ amount: "1600.00", discount_application_index: 0 }] }]
    }), "RAUSHAN30").items;
    expect(line.gross).toBe(4598);
    expect(line.couponDiscount).toBe(1600);
  });

  it("falls back to total_discount where a shop reports no allocation", () => {
    const [line] = mapOrder(order({
      line_items: [{ id: 9001, title: "Kit", quantity: 1, price: "2299.00", total_discount: "800.00", discount_allocations: [] }]
    }), "RAUSHAN30").items;
    // Nothing says the coupon did it, so it counts as somebody else's — which is
    // what raises `wholeOrderFallback` downstream rather than paying on nothing.
    expect(line.couponDiscount).toBe(0);
    expect(line.otherDiscount).toBe(800);
  });

  it("takes a line refund off what was paid", () => {
    const mapped = mapOrder(order({
      refunds: [{ refund_line_items: [{ line_item_id: 9001, subtotal: "1499.00", total_tax: "0.00" }] }]
    }), "RAUSHAN30");
    expect(mapped.items[0].refunded).toBe(1499);
    expect(mapped.totals.paid).toBe(0);
  });

  it("ignores a refund with no line behind it — shipping is not the product", () => {
    const mapped = mapOrder(order({ refunds: [{ transactions: [{ kind: "refund", status: "success", amount: "60.00" }] }] }), "RAUSHAN30");
    expect(mapped.items[0].refunded).toBe(0);
    expect(mapped.totals.paid).toBe(1499);
  });

  it("carries the facts a screen needs", () => {
    const mapped = mapOrder(order({
      cancelled_at: "2026-08-02T09:00:00+05:30",
      financial_status: "refunded",
      payment_gateway_names: ["Cash on Delivery (COD)"],
      shipping_address: { city: "Patna", province: "Bihar", zip: "800001" }
    }), "RAUSHAN30");

    expect(mapped.name).toBe("#1042");
    expect(mapped.shopifyOrderId).toBe("5001");
    expect(mapped.paymentMethod).toBe("COD");
    expect(mapped.customer.city).toBe("Patna");
    expect(mapped.cancelledAt).toBeInstanceOf(Date);
    expect(mapped.fullyRefunded).toBe(true);
  });
});
