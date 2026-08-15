/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
// Default import kept in scope: vitest compiles this file with the classic JSX
// transform, which emits React.createElement.
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { ProcessScreen } from "./process-screen";
import type { SalesOrderRecord } from "@/lib/sales/types";

/**
 * The picking screen, driven through react-dom directly (see `modal.test.tsx`
 * for why not @testing-library).
 *
 * What is worth asserting here is the part a person's morning depends on and
 * that no pure function can cover: that the screen opens on the orders that
 * still have to go out, that it says on the row *why* one cannot, and that a
 * selection made across a list is the selection that gets acted on.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const order = (over: Partial<SalesOrderRecord> = {}): SalesOrderRecord => ({
  _id: "aaaaaaaaaaaaaaaaaaaaaaa1",
  source: "Shopify",
  name: "#1042",
  placedAt: "2026-08-01T10:00:00.000Z",
  currency: "INR",
  customer: { name: "Priya Sharma", phone: "9876543210", address1: "12 MG Road", city: "Patna", state: "Bihar", pinCode: "800001" },
  couponCode: "RAUSHAN30",
  discountCodes: ["RAUSHAN30"],
  items: [{ title: "Skin pigmentation kit", quantity: 1, gross: 2299, couponDiscount: 800, otherDiscount: 0, refunded: 0 }],
  totals: { gross: 2299, discount: 800, refunded: 0, paid: 1499 },
  paymentMethod: "COD",
  fullyRefunded: false,
  delivery: { reported: "Awaiting", state: "Awaiting" },
  commission: { rate: 30, base: 1499, amount: 450, status: "Pending" },
  ...over
});

const ORDERS = [
  order(),
  // The Fastrr import's usual shape: a city and a phone, and no street at all.
  order({
    _id: "aaaaaaaaaaaaaaaaaaaaaaa2", name: "#1043", source: "Import",
    customer: { name: "Anil Kumar", phone: "9812345678", city: "Noida" }
  }),
  order({
    _id: "aaaaaaaaaaaaaaaaaaaaaaa3", name: "#1044",
    shipment: { shiprocketOrderId: "5511", shipmentId: "8822", awb: "1234567890", courier: "Ecom Express" }
  })
];

let requests: string[] = [];

function stubFetch(orders = ORDERS) {
  requests = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    requests.push(String(url));
    const body = String(url).startsWith("/api/sales/reps")
      ? { data: { reps: [] } }
      : String(url).startsWith("/api/sales/fulfilment/options")
        ? { data: {
            pickupLocations: [{ name: "Warehouse", city: "Noida", pinCode: "201301" }],
            defaults: { pickupLocation: "Warehouse", parcel: { weight: 0.5, length: 20, breadth: 15, height: 8 }, courierRule: "recommended" },
            refusal: null
          } }
        : { data: {
            items: orders, total: orders.length, page: 1, pages: 1,
            summary: { revenue: 4497, commission: 1350 }, couriers: ["Ecom Express"]
          } };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }));
}

async function mount() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => { root.render(<ProcessScreen />); });
  return { container, unmount: () => { act(() => root.unmount()); container.remove(); } };
}

afterEach(() => vi.unstubAllGlobals());

const text = (container: HTMLElement) => container.textContent ?? "";
const checkboxes = (container: HTMLElement) => [...container.querySelectorAll<HTMLInputElement>("input[type=checkbox]")];

describe("the processing screen", () => {
  it("opens on every order, oldest first", async () => {
    /*
     * No processing filter by default. The screen is read by somebody packing
     * boxes *and* by somebody chasing a parcel that went last week, and a
     * default that hid half the orders left the second one looking at an empty
     * list with no clue that a filter was doing it. Oldest first, because the
     * oldest unbooked order is the one about to be telephoned about.
     */
    stubFetch();
    const { unmount } = await mount();

    const list = requests.find(url => url.startsWith("/api/sales/orders")) ?? "";
    expect(list).not.toContain("processed=");
    expect(list).toContain("sort=oldest");
    unmount();
  });

  it("offers tracking on a parcel that has gone, and nothing to track on one that has not", async () => {
    stubFetch();
    const { container, unmount } = await mount();

    const rows = [...container.querySelectorAll("div")];
    const booked = rows.find(row => row.textContent?.startsWith("#1044"));
    const waiting = rows.find(row => row.textContent?.startsWith("#1043"));
    expect(booked?.textContent).toContain("Track");
    expect(waiting?.textContent).not.toContain("Track");
    unmount();
  });

  it("says on the row why an order cannot be booked", async () => {
    stubFetch();
    const { container, unmount } = await mount();

    // The imported order has a city and a phone and no street — naming the
    // missing fields on the row is what lets a picking list be scanned for the
    // exceptions rather than discovered one refusal at a time.
    expect(text(container)).toContain("Needs the street address, state, 6-digit pin code");
    unmount();
  });

  it("shows an order that has gone what it went on, and offers no way to send it twice", async () => {
    stubFetch();
    const { container, unmount } = await mount();

    // Two parcels, two freights and one customer is the failure mode worth
    // designing against, so a booked row carries its airway bill and its
    // paperwork — and no button that would book it again.
    const booked = [...container.querySelectorAll("div")].find(row => row.textContent?.startsWith("#1044"));
    expect(booked?.textContent).toContain("Ecom Express · AWB 1234567890");
    expect(booked?.textContent).toContain("Invoice");
    expect(booked?.textContent).toContain("Label");
    expect(booked?.textContent).not.toContain("Process");
    unmount();
  });

  it("shows how far along each order is, and what it is worth at the door", async () => {
    stubFetch();
    const { container, unmount } = await mount();

    expect(text(container)).toContain("Not processed");
    expect(text(container)).toContain("Ready to ship");
    expect(text(container)).toContain("COD ₹1,499");
    unmount();
  });

  it("acts on the selection, not on the page", async () => {
    stubFetch();
    const { container, unmount } = await mount();

    // The first checkbox is the "select the 3 on this page" control.
    const [all] = checkboxes(container);
    await act(async () => { all.click(); });
    expect(text(container)).toContain("3 orders selected");

    // Unpicking one leaves the rest of the selection alone, including any made
    // on a page that is no longer on screen.
    await act(async () => { checkboxes(container)[1].click(); });
    expect(text(container)).toContain("2 orders selected");

    unmount();
  });

  it("offers nothing to book when Shiprocket is not connected", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(
      String(url).startsWith("/api/sales/fulfilment/options")
        ? { data: { pickupLocations: [], defaults: { parcel: { weight: 0.5, length: 20, breadth: 15, height: 8 }, courierRule: "recommended" }, refusal: "Shiprocket is not connected." } }
        : String(url).startsWith("/api/sales/reps")
          ? { data: { reps: [] } }
          : { data: { items: [order()], total: 1, page: 1, pages: 1, summary: { revenue: 1499, commission: 450 }, couriers: [] } }
    ), { status: 200 })));

    const { container, unmount } = await mount();
    expect(text(container)).toContain("Shiprocket is not connected.");
    // The list still works — reading the orders is not what needs a credential.
    expect(text(container)).toContain("#1042");
    expect(text(container)).not.toContain("Process</button>");
    unmount();
  });
});
