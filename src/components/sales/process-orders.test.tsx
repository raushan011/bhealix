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

function stubFetch() {
  posted = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const body = init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    posted.push({ url: String(url), body });
    const ids = (body.orderIds ?? []) as string[];
    return new Response(JSON.stringify({ data: {
      results: ids.map(id => ({ orderId: id, name: id, ok: true, awb: "1234567890", courier: "Ecom Express" })),
      booked: ids.length, failed: 0
    } }), { status: 200 });
  }));
}

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

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("the booking dialog", () => {
  it("sends a long selection in chunks, and loses nothing between them", async () => {
    stubFetch();
    const orders = Array.from({ length: 7 }, (_, at) => order(at));
    const { unmount } = await mount(orders);

    await act(async () => { button("Book 7 orders")?.click(); });

    // PROCESS_BATCH is five, so seven orders is five and then two.
    expect(posted.map(request => (request.body.orderIds as string[]).length)).toEqual([5, 2]);
    expect(posted.flatMap(request => request.body.orderIds as string[]).sort())
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

    await act(async () => { button("Book 1 order")?.click(); });
    expect(posted).toHaveLength(1);
    expect(posted[0].body.orderIds).toEqual([orders[0]._id]);
    unmount();
  });

  it("sends the courier rule for a batch and a named courier only when one was chosen", async () => {
    stubFetch();
    const { unmount } = await mount([order(1), order(2)]);

    await act(async () => { button("Book 2 orders")?.click(); });
    expect(posted[0].body).toMatchObject({ courierRule: "recommended", pickupLocation: "Warehouse", schedulePickup: false });
    expect(posted[0].body.courierId).toBeUndefined();
    // An address belongs to one order; a batch must never carry one, or forty
    // parcels go to the same doorstep.
    expect(posted[0].body.address).toBeUndefined();
    unmount();
  });

  it("carries the address for a single order, where one can be typed", async () => {
    stubFetch();
    const { unmount } = await mount([order(1)]);

    await act(async () => { button("Book 1 order")?.click(); });
    expect(posted[0].body.address).toMatchObject({ address1: "12 MG Road", pinCode: "800001", country: "India" });
    unmount();
  });

  it("reports every order in the run, not a total", async () => {
    stubFetch();
    const { unmount } = await mount([order(1), order(2)]);

    await act(async () => { button("Book 2 orders")?.click(); });
    expect(dialogText()).toContain("AWB 1234567890");
    expect(button("Invoices")).toBeDefined();
    expect(button("Labels")).toBeDefined();
    unmount();
  });
});
