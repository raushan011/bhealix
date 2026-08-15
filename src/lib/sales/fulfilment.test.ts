import { describe, expect, it } from "vitest";
import {
  addressOf, blockedReason, buildAdhocOrder, documentFileName, missingFields, normaliseParcel, orderCount,
  parcelValueOf, paymentModeOf, pickCourier, processStateOf, shiprocketDate, tenDigitPhone,
  type BookableOrder, type CourierOption
} from "./fulfilment";

/** One kit, delivered to Patna, exactly as the Shopify sync stores it. */
const order = (over: Partial<BookableOrder> = {}): BookableOrder => ({
  name: "#1042",
  placedAt: "2026-08-01T10:00:00+05:30",
  customer: {
    name: "Priya Sharma", phone: "+91 98765 43210", email: "priya@example.com",
    address1: "12 MG Road", city: "Patna", state: "Bihar", pinCode: "800001"
  },
  items: [{ sku: "KIT-PIG-01", title: "Skin pigmentation kit", quantity: 1, gross: 2299, couponDiscount: 800, otherDiscount: 0 }],
  totals: { paid: 1499, gross: 2299 },
  paymentMethod: "COD",
  ...over
});

describe("paymentModeOf", () => {
  it("reads the word the sync already reduced every gateway to", () => {
    expect(paymentModeOf(order())).toBe("COD");
    expect(paymentModeOf(order({ paymentMethod: "Razorpay" }))).toBe("Prepaid");
    expect(paymentModeOf(order({ paymentMethod: "Cash on Delivery (COD)" }))).toBe("COD");
  });

  it("falls back to whether the money actually arrived", () => {
    // An imported order carries no gateway at all. Guessing prepaid on one that
    // was never paid hands the parcel over for nothing, so unpaid means COD.
    expect(paymentModeOf(order({ paymentMethod: undefined, financialStatus: "paid" }))).toBe("Prepaid");
    expect(paymentModeOf(order({ paymentMethod: undefined, financialStatus: "pending" }))).toBe("COD");
  });
});

describe("tenDigitPhone", () => {
  it("takes the ten digits out of however the checkout stored them", () => {
    expect(tenDigitPhone("+91 98765 43210")).toBe("9876543210");
    expect(tenDigitPhone("09876543210")).toBe("9876543210");
    expect(tenDigitPhone("91-9876543210")).toBe("9876543210");
  });

  it("is empty for anything a courier would refuse", () => {
    expect(tenDigitPhone("12345")).toBe("");
    // Indian mobiles start 6-9; a landline is not a number a courier can ring
    // from the doorstep, and sending it produces a validation error per order.
    expect(tenDigitPhone("1234567890")).toBe("");
    expect(tenDigitPhone(undefined)).toBe("");
  });
});

describe("missingFields", () => {
  it("says nothing about a complete address", () => {
    expect(missingFields(addressOf(order()))).toEqual([]);
  });

  it("names every field the courier would refuse, in one list", () => {
    const missing = missingFields(addressOf(order({
      customer: { name: "Priya", city: "Patna", pinCode: "8000", phone: "12345" }
    })));
    expect(missing).toEqual(["street address", "state", "6-digit pin code", "10-digit phone number"]);
  });
});

describe("addressOf", () => {
  it("lets what somebody typed win", () => {
    const merged = addressOf(order(), { address1: "Flat 4, Ganga Apartments", pinCode: "800020" });
    expect(merged.address1).toBe("Flat 4, Ganga Apartments");
    expect(merged.pinCode).toBe("800020");
    expect(merged.city).toBe("Patna");
  });

  it("does not let an empty box blank out what the order already knew", () => {
    const merged = addressOf(order(), { address1: "   ", city: "" });
    expect(merged.address1).toBe("12 MG Road");
    expect(merged.city).toBe("Patna");
  });

  it("assumes India, which is the only country this ships to", () => {
    expect(addressOf(order()).country).toBe("India");
  });
});

describe("blockedReason", () => {
  it("lets an ordinary order through", () => {
    expect(blockedReason(order())).toBeNull();
  });

  it("refuses to book a parcel twice", () => {
    // The whole point: two bookings is two parcels, two freights and one
    // customer, and nothing downstream would ever notice.
    expect(blockedReason(order({ shipment: { awb: "1234567890", courier: "Delhivery" } })))
      .toMatch(/Already booked on Delhivery/);
  });

  it("refuses a cancelled, refunded or empty order", () => {
    expect(blockedReason(order({ cancelledAt: "2026-08-02" }))).toMatch(/cancelled/);
    expect(blockedReason(order({ fullyRefunded: true }))).toMatch(/refunded/);
    expect(blockedReason(order({ items: [] }))).toMatch(/no items/);
  });
});

describe("processStateOf", () => {
  it("reads the parcel's own progress, not the courier's", () => {
    expect(processStateOf(order())).toBe("Not processed");
    expect(processStateOf(order({ shipment: { shiprocketOrderId: "551" } }))).toBe("Booked");
    expect(processStateOf(order({ shipment: { shiprocketOrderId: "551", shipmentId: "9", awb: "12345" } }))).toBe("Ready to ship");
    expect(processStateOf(order({ shipment: { awb: "12345", pickupScheduledAt: "2026-08-02" } }))).toBe("Pickup scheduled");
  });
});

describe("normaliseParcel", () => {
  it("falls back to the default carton rather than sending a zero", () => {
    expect(normaliseParcel({ weight: 0, length: -3 })).toEqual({ weight: 0.5, length: 20, breadth: 15, height: 8 });
    expect(normaliseParcel(null)).toEqual({ weight: 0.5, length: 20, breadth: 15, height: 8 });
  });

  it("keeps a real measurement", () => {
    expect(normaliseParcel({ weight: 1.25, length: 30, breadth: 20, height: 10 }))
      .toEqual({ weight: 1.25, length: 30, breadth: 20, height: 10 });
  });
});

describe("shiprocketDate", () => {
  it("writes the one format Shiprocket accepts, in local time", () => {
    // Local rather than UTC on purpose: the account, the courier and the
    // warehouse are all Indian, and shifting the zone files an order placed at
    // ten past midnight under the previous day.
    const at = new Date(2026, 7, 1, 14, 30);
    expect(shiprocketDate(at)).toBe("2026-08-01 14:30");
  });

  it("falls back to now rather than sending nonsense", () => {
    expect(shiprocketDate("not a date")).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
});

describe("parcelValueOf", () => {
  it("declares what the customer actually owes, after the coupon", () => {
    // Booking a COD parcel at the gross would have the courier collect the
    // discount back off the customer at the door.
    expect(parcelValueOf(order())).toBe(1499);
    expect(parcelValueOf(order({ totals: { paid: 0 } }))).toBe(0);
  });
});

describe("buildAdhocOrder", () => {
  const built = () => buildAdhocOrder({
    order: order(),
    address: addressOf(order()),
    parcel: normaliseParcel({ weight: 1, length: 25, breadth: 18, height: 9 }),
    pickupLocation: "Warehouse"
  });

  it("files the parcel under the shop's own order name", () => {
    // This is the key the delivery sync joins back on. Booking under anything
    // else creates a parcel this CRM can never find again — and a rep whose
    // order was delivered would never be paid for it.
    expect(built().order_id).toBe("#1042");
  });

  it("splits the name the way Shiprocket asks for it", () => {
    expect(built().billing_customer_name).toBe("Priya");
    expect(built().billing_last_name).toBe("Sharma");
  });

  it("prices each line at what was actually paid for it, per unit", () => {
    expect(built().order_items).toEqual([
      { name: "Skin pigmentation kit", sku: "KIT-PIG-01", units: 1, selling_price: 1499 }
    ]);
    expect(built().sub_total).toBe(1499);
  });

  it("divides a multiple-quantity line by its units", () => {
    const payload = buildAdhocOrder({
      order: order({ items: [{ title: "Kit", quantity: 2, gross: 4598, couponDiscount: 1600, otherDiscount: 0 }] }),
      address: addressOf(order()), parcel: normaliseParcel(null), pickupLocation: "Warehouse"
    });
    expect(payload.order_items[0]).toEqual({ name: "Kit", sku: "LINE-1", units: 2, selling_price: 1499 });
  });

  it("carries the parcel and the payment mode", () => {
    expect(built()).toMatchObject({
      pickup_location: "Warehouse", payment_method: "COD", shipping_is_billing: true,
      weight: 1, length: 25, breadth: 18, height: 9, billing_phone: "9876543210", billing_country: "India"
    });
  });
});

// A shortlist of what Shiprocket answered for one pin code.
const couriers: CourierOption[] = [
  { id: 1, name: "Bluedart Surface", rate: 62, days: 4, surface: true },
  { id: 2, name: "Delhivery Air", rate: 91, days: 2 },
  { id: 3, name: "Ecom Express", rate: 74, days: 3, recommended: true }
];

describe("pickCourier", () => {
  it("takes Shiprocket's own pick by default", () => {
    expect(pickCourier(couriers, {}).courier?.id).toBe(3);
  });

  it("falls back to the cheapest when Shiprocket names nobody", () => {
    expect(pickCourier(couriers.map(courier => ({ ...courier, recommended: false })), { rule: "recommended" }).courier?.id).toBe(1);
  });

  it("picks on price and on days when asked to", () => {
    expect(pickCourier(couriers, { rule: "cheapest" }).courier?.id).toBe(1);
    expect(pickCourier(couriers, { rule: "fastest" }).courier?.id).toBe(2);
  });

  it("separates two couriers promising the same day by price", () => {
    const tie: CourierOption[] = [
      { id: 4, name: "Slow but dear", rate: 120, days: 2 },
      { id: 5, name: "Just as quick", rate: 80, days: 2 }
    ];
    expect(pickCourier(tie, { rule: "fastest" }).courier?.id).toBe(5);
  });

  it("uses a named courier, and never substitutes another for it", () => {
    // A batch told to go by Delhivery and quietly sent by three other couriers
    // is worse than one that says which orders Delhivery cannot serve.
    expect(pickCourier(couriers, { id: 2 }).courier?.name).toBe("Delhivery Air");
    const refused = pickCourier(couriers, { id: 99 });
    expect(refused.courier).toBeUndefined();
    expect(refused.error).toMatch(/does not serve this pin code/);
  });

  it("says so when nothing can reach the address", () => {
    expect(pickCourier([], { rule: "cheapest" }).error).toMatch(/No courier serves this pin code/);
  });
});

describe("presentation", () => {
  it("counts orders in words a progress line can use", () => {
    expect(orderCount(1)).toBe("1 order");
    expect(orderCount(12)).toBe("12 orders");
  });

  it("names a download after its order, or after how many there are", () => {
    expect(documentFileName("invoice", ["#1042"])).toBe("invoice-1042.pdf");
    expect(documentFileName("label", ["#1042", "#1043"])).toBe("label-2-orders.pdf");
  });
});
