/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { ProcessDialog } from "./process-orders";
import type { FulfilmentOptions, SalesOrderRecord } from "@/lib/sales/types";

/**
 * The booking dialog, and the two things about it that are easy to get wrong
 * and expensive when they are.
 *
 * A long selection is sent in chunks, so the arithmetic of which orders land in
 * which request has to be right — an order silently dropped between chunks is a
 * parcel nobody posts. And an order that cannot be booked must be left out of
 * the request entirely rather than sent to be refused, because thirty round
 * trips to be told what was knowable up front is a minute of somebody's morning.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const options: FulfilmentOptions = {
  pickupLocations: [{ name: "Warehouse", city: "Noida", pinCode: "201301" }],
  defaults: { pickupLocation: "Warehouse", parcel: { weight: 0.5, length: 20, breadth: 15, height: 8 }, courierRule: "recommended" },
  refusal: null
};

const order = (n: number, over: Partial<SalesOrderRecord> = {}): SalesOrderRecord => ({
  _id: `aaaaaaaaaaaaaaaaaaaaaa${String(n).padStart(2, "0")}`,
  source: "Shopify",
  name: `#10${40 + n}`,
  placedAt: "2026-08-01T10:00:00.000Z",
  currency: "INR",
  customer: { name: "Priya Sharma", phone: "9876543210", address1: "12 MG Road", city: "Patna", state: "Bihar", pinCode: "800001" },
  discountCodes: [],
  items: [{ title: "Kit", quantity: 1, gross: 2299, couponDiscount: 800, otherDiscount: 0, refunded: 0 }],
  totals: { gross: 2299, discount: 800, refunded: 0, paid: 1499 },
  paymentMethod: "COD",
  fullyRefunded: false,
  delivery: { reported: "Awaiting", state: "Awaiting" },
  commission: { rate: 30, base: 1499, amount: 450, status: "Pending" },
  ...over
});

type Posted = { url: string; body: Record<string, unknown> };
let posted: Posted[] = [];

/** What Shiprocket says serves the address — two couriers, one dearer and quicker. */
const COURIERS = [
  { id: 12, name: "Bluedart Surface", rate: 62, days: 4, surface: true },
  { id: 51, name: "Ecom Express", rate: 91, days: 2, recommended: true }
];

function stubFetch() {
  posted = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const body = init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    const target = String(url);
    posted.push({ url: target, body });

    if (target.includes("/fulfilment/couriers")) {
      return new Response(JSON.stringify({ data: { couriers: COURIERS, from: "Warehouse", cod: true } }), { status: 200 });
    }
    if (target.includes("/fulfilment/address")) {
      return new Response(JSON.stringify({ data: { address: {}, missing: [], fetched: false } }), { status: 200 });
    }

    const ids = (body.orderIds ?? []) as string[];
    return new Response(JSON.stringify({ data: {
      results: ids.map(id => ({ orderId: id, name: id, ok: true, awb: "1234567890", courier: "Ecom Express" })),
      booked: ids.length, failed: 0
    } }), { status: 200 });
  }));
}

const bookings = () => posted.filter(request => request.url.includes("/orders/process"));

async function mount(orders: SalesOrderRecord[]) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<ProcessDialog orders={orders} options={options} onClose={() => {}} onDone={() => {}} />);
  });
  return { unmount: () => { act(() => root.unmount()); container.remove(); } };
}

/** The dialog is portalled to the body, so it is found there rather than in the container. */
const dialogText = () => document.body.textContent ?? "";
const button = (label: string) =>
  [...document.body.querySelectorAll("button")].find(node => node.textContent?.includes(label));

/**
 * Choosing from a `<select>`. React listens for `change` on the element itself,
 * and setting `.value` directly does not raise one — so the native setter is
 * called and the event dispatched by hand, which is what React's own test
 * utilities do underneath.
 */
async function choose(value: string) {
  const select = [...document.body.querySelectorAll("select")]
    .find(node => [...node.options].some(option => option.value === value));
  if (!select) throw new Error(`No select offers ${value}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("the booking dialog", () => {
  it("shows the couriers and what each costs as soon as it opens", async () => {
    // Freight is money, and the spread between the cheapest and the quickest on
    // one parcel is routinely half the margin on the order. It is not hidden
    // behind a button, and it is not chosen for anybody by default.
    stubFetch();
    const { unmount } = await mount([order(1)]);

    expect(posted.some(request => request.url.includes("/fulfilment/couriers"))).toBe(true);
    expect(dialogText()).toContain("Bluedart Surface");
    expect(dialogText()).toContain("₹62");
    expect(dialogText()).toContain("Ecom Express");
    expect(dialogText()).toContain("₹91");
    // Cheapest first, and what the dearer one costs over it.
    expect(dialogText()).toContain("+₹29");
    unmount();
  });

  it("sends the courier that was picked, by id", async () => {
    stubFetch();
    const { unmount } = await mount([order(1)]);

    await act(async () => { button("Ecom Express")?.click(); });
    await act(async () => { button("Book 1 order")?.click(); });

    expect(bookings()[0].body).toMatchObject({ courierId: 51, courierName: "Ecom Express" });
    expect(bookings()[0].body.courierRule).toBeUndefined();
    unmount();
  });

  it("refuses to book on a courier nobody chose", async () => {
    stubFetch();
    const { unmount } = await mount([order(1)]);

    await act(async () => { button("Book 1 order")?.click(); });
    expect(bookings()).toHaveLength(0);
    expect(dialogText()).toContain("Choose a courier from the list");
    unmount();
  });

  it("sends a rule instead when one is chosen, and no courier id with it", async () => {
    stubFetch();
    const { unmount } = await mount([order(1), order(2)]);

    await choose("cheapest");
    await act(async () => { button("Book 2 orders")?.click(); });

    expect(bookings()[0].body).toMatchObject({ courierRule: "cheapest", pickupLocation: "Warehouse", schedulePickup: false });
    expect(bookings()[0].body.courierId).toBeUndefined();
    // An address belongs to one order; a batch must never carry one, or forty
    // parcels go to the same doorstep.
    expect(bookings()[0].body.address).toBeUndefined();
    unmount();
  });

  it("sends a long selection in chunks, and loses nothing between them", async () => {
    stubFetch();
    const orders = Array.from({ length: 7 }, (_, at) => order(at));
    const { unmount } = await mount(orders);

    await choose("recommended");
    await act(async () => { button("Book 7 orders")?.click(); });

    // PROCESS_BATCH is five, so seven orders is five and then two.
    expect(bookings().map(request => (request.body.orderIds as string[]).length)).toEqual([5, 2]);
    expect(bookings().flatMap(request => request.body.orderIds as string[]).sort())
      .toEqual(orders.map(one => one._id).sort());
    unmount();
  });

  it("leaves out what it already knows cannot be booked, and says which", async () => {
    stubFetch();
    const orders = [
      order(1),
      order(2, { customer: { name: "Anil", phone: "9812345678", city: "Noida" } }),
      order(3, { cancelledAt: "2026-08-02T00:00:00.000Z" })
    ];
    const { unmount } = await mount(orders);

    expect(dialogText()).toContain("2 of 3 cannot be booked");
    expect(dialogText()).toContain("was cancelled");

    await choose("recommended");
    await act(async () => { button("Book 1 order")?.click(); });
    expect(bookings()).toHaveLength(1);
    expect(bookings()[0].body.orderIds).toEqual([orders[0]._id]);
    unmount();
  });

  it("carries the address for a single order, where one can be typed", async () => {
    stubFetch();
    const { unmount } = await mount([order(1)]);

    await act(async () => { button("Bluedart Surface")?.click(); });
    await act(async () => { button("Book 1 order")?.click(); });
    expect(bookings()[0].body.address).toMatchObject({ address1: "12 MG Road", pinCode: "800001", country: "India" });
    unmount();
  });

  it("asks the shop for an address this system never kept", async () => {
    // Every order placed before parcels were booked from here has a city and a
    // pin code and no street: those were the only fields the commission
    // arithmetic needed. Shopify has had the rest all along.
    stubFetch();
    const { unmount } = await mount([order(1, { customer: { name: "Anil", phone: "9812345678", city: "Noida" } })]);

    const asked = posted.find(request => request.url.includes("/fulfilment/address"));
    expect(asked?.body.orderId).toBe("aaaaaaaaaaaaaaaaaaaaaa01");
    unmount();
  });

  it("does not ask the shop for an address it already has", async () => {
    stubFetch();
    const { unmount } = await mount([order(1)]);
    expect(posted.some(request => request.url.includes("/fulfilment/address"))).toBe(false);
    unmount();
  });

  it("reports every order in the run, not a total", async () => {
    stubFetch();
    const { unmount } = await mount([order(1), order(2)]);

    await choose("recommended");
    await act(async () => { button("Book 2 orders")?.click(); });
    expect(dialogText()).toContain("AWB 1234567890");
    expect(button("Invoices")).toBeDefined();
    expect(button("Labels")).toBeDefined();
    unmount();
  });
});
