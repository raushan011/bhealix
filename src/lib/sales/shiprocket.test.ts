import { afterEach, describe, expect, it, vi } from "vitest";
import { IntegrationError } from "./http";
import {
  assignAwb, createOrder, documentUrl, matchKeysFor, pickupLocations, schedulePickup, serviceability, toCourierOptions,
  trackByAwb
} from "./shiprocket";
import type { AdhocOrderPayload } from "./fulfilment";

/**
 * The booking half of the Shiprocket client.
 *
 * `fetch` is stubbed rather than a server being stood up: what is worth checking
 * is that the right thing is sent to the right endpoint and that the two ways
 * this API says no — an HTTP error, and a 200 whose body says the request was
 * declined — both come back as something an operator can read. The second is the
 * one that bites: Shiprocket answers 200 with `awb_assign_status: 0` when it
 * refuses an airway bill, and a client that only checks the status code books
 * nothing and reports success.
 */

type Call = { url: string; method: string; body: unknown };
/**
 * An HTTP failure, as opposed to a body. Marked with a key of its own rather
 * than by looking for `status`, because half these bodies carry a `status` field
 * of Shiprocket's own — which is exactly the confusion this wrapper exists to
 * keep out of the tests.
 */
const httpError = (httpStatus: number, body: unknown) => ({ __httpStatus: httpStatus, body });

function stubFetch(...replies: unknown[]) {
  const calls: Call[] = [];
  let at = 0;

  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({
      url: String(url),
      method: init.method ?? "GET",
      body: init.body ? JSON.parse(String(init.body)) : undefined
    });
    const reply = replies[Math.min(at++, replies.length - 1)] as { __httpStatus?: number; body?: unknown };
    const failed = reply && typeof reply === "object" && "__httpStatus" in reply;
    return new Response(JSON.stringify(failed ? reply.body : reply), { status: failed ? reply.__httpStatus : 200 });
  }));

  return calls;
}

afterEach(() => vi.unstubAllGlobals());

const payload = {
  order_id: "#1042", order_date: "2026-08-01 10:00", pickup_location: "Warehouse",
  billing_customer_name: "Priya", billing_last_name: "Sharma", billing_address: "12 MG Road",
  billing_city: "Patna", billing_pincode: "800001", billing_state: "Bihar", billing_country: "India",
  billing_phone: "9876543210", shipping_is_billing: true,
  order_items: [{ name: "Kit", sku: "KIT-1", units: 1, selling_price: 1499 }],
  payment_method: "COD", sub_total: 1499, length: 20, breadth: 15, height: 8, weight: 0.5
} as AdhocOrderPayload;

describe("pickupLocations", () => {
  it("reads the account's warehouses, and drops any without a name to book against", () => {
    stubFetch({ data: { shipping_address: [
      { pickup_location: "Warehouse", city: "Noida", pin_code: 201301 },
      { pickup_location: "  ", city: "Nowhere" }
    ] } });

    return expect(pickupLocations("token")).resolves.toEqual([
      { name: "Warehouse", address: undefined, city: "Noida", state: undefined, pinCode: "201301", phone: undefined }
    ]);
  });
});

describe("createOrder", () => {
  it("posts the order and returns the shipment it was given", async () => {
    const calls = stubFetch({ order_id: 5511, shipment_id: 8822, status: "NEW" });

    await expect(createOrder("token", payload)).resolves.toEqual({
      shiprocketOrderId: "5511", shipmentId: "8822", status: "NEW"
    });
    expect(calls[0].url).toContain("/orders/create/adhoc");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toMatchObject({ order_id: "#1042", payment_method: "COD" });
  });

  it("refuses to report success when no shipment came back", async () => {
    // Shiprocket answers 200 with a message when it declines — most often a
    // duplicate order id, which is a shop whose channel already pushed it across.
    stubFetch({ message: "Order id already exists" });
    await expect(createOrder("token", payload)).rejects.toThrow(/already exists/);
  });

  it("passes the other side's own words on when it errors outright", async () => {
    stubFetch(httpError(422, { message: "The billing phone must be 10 digits." }));
    await expect(createOrder("token", payload)).rejects.toThrow(/10 digits/);
  });
});

describe("toCourierOptions", () => {
  it("reduces the list to what somebody chooses on", () => {
    const options = toCourierOptions({
      recommended_courier_company_id: 51,
      available_courier_companies: [
        { courier_company_id: 51, courier_name: "Ecom Express", rate: "74.5", estimated_delivery_days: "3", etd: "Aug 4", rating: "4.2" },
        { courier_company_id: 12, courier_name: "Bluedart Surface", freight_charge: 50, cod_charges: 12, is_surface: true, cod: 1 }
      ]
    });

    expect(options).toEqual([
      { id: 51, name: "Ecom Express", rate: 75, days: 3, etd: "Aug 4", rating: 4.2, surface: false, cod: false, recommended: true },
      { id: 12, name: "Bluedart Surface", rate: 62, days: undefined, etd: undefined, rating: undefined, surface: true, cod: true, recommended: false }
    ]);
  });

  it("drops a row with no courier id, which cannot be booked with", () => {
    expect(toCourierOptions({ available_courier_companies: [{ courier_name: "Nameless" }] })).toEqual([]);
  });

  it("is empty rather than undefined when nothing serves the address", () => {
    expect(toCourierOptions(undefined)).toEqual([]);
  });
});

describe("serviceability", () => {
  it("asks about this parcel, at this pin code, with the cash flag set", async () => {
    // COD changes the answer and not only the price: some couriers will not
    // carry cash to some pin codes at all.
    const calls = stubFetch({ data: { available_courier_companies: [] } });
    await serviceability("token", { pickupPincode: "201301", deliveryPincode: "800001", weight: 1.5, cod: true, declaredValue: 1499 });

    expect(calls[0].url).toContain("pickup_postcode=201301");
    expect(calls[0].url).toContain("delivery_postcode=800001");
    expect(calls[0].url).toContain("weight=1.5");
    expect(calls[0].url).toContain("cod=1");
    expect(calls[0].url).toContain("declared_value=1499");
  });
});

describe("assignAwb", () => {
  it("returns the airway bill and the courier that took it", async () => {
    const calls = stubFetch({ awb_assign_status: 1, response: { data: {
      awb_code: 1234567890, courier_name: "Ecom Express", courier_company_id: 51
    } } });

    await expect(assignAwb("token", "8822", 51)).resolves.toEqual({
      awb: "1234567890", courier: "Ecom Express", courierId: 51
    });
    expect(calls[0].body).toEqual({ shipment_id: 8822, courier_id: 51 });
  });

  it("treats a 200 that says no as a failure, with the reason on it", async () => {
    stubFetch({ awb_assign_status: 0, response: { data: {}, message: "Insufficient wallet balance" } });
    const failure = assignAwb("token", "8822", 51);

    await expect(failure).rejects.toThrow(IntegrationError);
    await expect(failure).rejects.toThrow(/Insufficient wallet balance/);
  });
});

describe("schedulePickup", () => {
  it("asks for the one shipment and reads back the date it was given", async () => {
    const calls = stubFetch({ pickup_status: 1, response: {
      pickup_scheduled_date: "2026-08-02 10:00:00", pickup_token_number: "RC-9912"
    } });

    const booking = await schedulePickup("token", "8822");
    expect(calls[0].body).toEqual({ shipment_id: [8822] });
    expect(booking.token).toBe("RC-9912");
    expect(booking.scheduledAt?.getFullYear()).toBe(2026);
  });
});

describe("documentUrl", () => {
  it("keys an invoice on the order and a label on the shipment", async () => {
    // Getting these the wrong way round produces an empty PDF rather than an
    // error, which is the kind of bug nobody notices until a customer does.
    const invoice = stubFetch({ invoice_url: "https://files/invoice.pdf" });
    await expect(documentUrl("token", "invoice", ["5511", "5512"])).resolves.toBe("https://files/invoice.pdf");
    expect(invoice[0].url).toContain("/orders/print/invoice");
    expect(invoice[0].body).toEqual({ ids: [5511, 5512] });

    vi.unstubAllGlobals();
    const label = stubFetch({ label_created: 1, label_url: "https://files/label.pdf" });
    await expect(documentUrl("token", "label", ["8822"])).resolves.toBe("https://files/label.pdf");
    expect(label[0].url).toContain("/courier/generate/label");
    expect(label[0].body).toEqual({ shipment_id: [8822] });
  });

  it("says a label needs an airway bill rather than handing back nothing", async () => {
    stubFetch({ label_created: 0 });
    await expect(documentUrl("token", "label", ["8822"])).rejects.toThrow(/needs an airway bill/);
  });

  it("refuses before calling when none of the orders were ever booked", async () => {
    const calls = stubFetch({});
    await expect(documentUrl("token", "invoice", ["", "0"])).rejects.toThrow(/have been booked/);
    expect(calls).toHaveLength(0);
  });
});

describe("trackByAwb", () => {
  it("reads the courier's movement history and the page a customer can be given", async () => {
    const calls = stubFetch({ tracking_data: {
      shipment_status: 17,
      shipment_track: [{ current_status: "In Transit", courier_name: "Ecom Express" }],
      shipment_track_activities: [
        { date: "2026-08-12 09:10:00", activity: "Out for delivery", location: "Patna" },
        { date: "2026-08-11 22:40:00", activity: "Reached destination hub", location: "Patna" }
      ],
      track_url: "https://shiprocket.co/tracking/1234567890"
    } });

    const tracking = await trackByAwb("token", "1234567890");
    expect(calls[0].url).toContain("/courier/track/awb/1234567890");
    expect(tracking.status).toBe("In Transit");
    expect(tracking.courier).toBe("Ecom Express");
    expect(tracking.scans).toHaveLength(2);
    expect(tracking.scans[0].activity).toBe("Out for delivery");
    expect(tracking.trackUrl).toContain("shiprocket.co/tracking");
  });

  it("says a parcel has not been collected yet, rather than failing", async () => {
    // The ordinary state of an airway bill assigned ten minutes ago. Treating it
    // as an error would have somebody re-book a parcel that is perfectly fine.
    stubFetch({ tracking_data: { track_status: 0 } });
    const tracking = await trackByAwb("token", "1234567890");

    expect(tracking.scans).toEqual([]);
    expect(tracking.note).toMatch(/has not scanned this parcel yet/);
    // Still worth a link: Shiprocket's own page works before the first scan.
    expect(tracking.trackUrl).toContain("1234567890");
  });
});

describe("matchKeysFor", () => {
  it("offers every form Shiprocket could have filed the order under", () => {
    expect(matchKeysFor({ name: "#1042", orderNumber: 1042, shopifyOrderId: "5001" }))
      .toEqual(["#1042", "1042", "5001"]);
  });
});
