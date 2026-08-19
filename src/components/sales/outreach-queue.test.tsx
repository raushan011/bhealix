/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
// Default import kept in scope: vitest compiles this file with the classic JSX
// transform, which emits React.createElement.
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { OutreachQueue } from "./outreach-queue";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The autopilot, driven with a clock in hand.
 *
 * What matters is the loop no pure function owns: Start opens the first chat
 * in one named WhatsApp Web window, the seconds tick, the *same* window is
 * navigated to the next lead — never a second `window.open`, because a timer's
 * open is what popup blockers eat — and every open is recorded as a contact.
 */

const LEADS = [
  { _id: "aaaaaaaaaaaaaaaaaaaaaaa1", name: "Glow Beauty Studio", type: "Beauty parlour", status: "New", phone: "096503 06893", city: "Ghaziabad" },
  { _id: "aaaaaaaaaaaaaaaaaaaaaaa2", name: "Sparsh Salon", type: "Beauty parlour", status: "New", phone: "098111 22334", city: "Ghaziabad" }
];

let contacted: string[] = [];

function stubFetch() {
  contacted = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url);
    let body: unknown = { data: {} };
    if (path.startsWith("/api/sales/templates")) {
      body = { data: { items: [{ _id: "t1", name: "Intro", body: "Hi {{name}}" }] } };
    } else if (path.includes("/contacted")) {
      contacted.push(path);
    } else if (path.startsWith("/api/sales/leads?")) {
      body = { data: { items: LEADS, total: LEADS.length, types: ["Beauty parlour"] } };
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  sessionStorage.clear();
  localStorage.clear();
  document.body.innerHTML = "";
});

async function mount() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => { root.render(<OutreachQueue mayEdit />); });
  await act(async () => { await Promise.resolve(); });
  return { container, unmount: () => { act(() => root.unmount()); container.remove(); } };
}

const button = (container: HTMLElement, text: string) =>
  Array.from(container.querySelectorAll("button")).find(candidate => candidate.textContent?.includes(text))!;

describe("the outreach autopilot", () => {
  it("opens each chat itself, reusing one window, and records every contact", async () => {
    stubFetch();
    const fakeWindow = { closed: false, location: { href: "" } };
    const open = vi.fn(() => fakeWindow as unknown as Window);
    vi.stubGlobal("open", open);

    const { container, unmount } = await mount();

    // Choose autopilot; jsdom's user agent is a desktop, so the pace field appears.
    const radios = container.querySelectorAll<HTMLInputElement>('input[name="outreach-mode"]');
    await act(async () => { radios[1].click(); });
    expect(container.textContent).toContain("Seconds between chats");

    vi.useFakeTimers();
    await act(async () => { button(container, "Start autopilot").click(); });
    await act(async () => { await Promise.resolve(); });

    // The first chat: a real window.open — this one rides the Start click —
    // straight into WhatsApp Web, no interstitial.
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0]).toContain("web.whatsapp.com/send?phone=919650306893");
    expect(open.mock.calls[0][1]).toBe("bhealix-whatsapp");
    expect(contacted.some(path => path.includes(LEADS[0]._id))).toBe(true);
    expect(container.textContent).toContain("Next chat in");

    // Eight ticks later the SAME window is pointed at the next lead.
    for (let tick = 0; tick < 8; tick++) {
      await act(async () => { vi.advanceTimersByTime(1000); });
    }
    await act(async () => { await Promise.resolve(); });

    expect(open).toHaveBeenCalledTimes(1);
    expect(fakeWindow.location.href).toContain("phone=919811122334");
    expect(contacted.some(path => path.includes(LEADS[1]._id))).toBe(true);
    expect(container.textContent).toContain("Sparsh Salon");

    unmount();
  });

  it("pauses instead of silently losing a lead when the browser blocks the window", async () => {
    stubFetch();
    vi.stubGlobal("open", vi.fn(() => null));

    const { container, unmount } = await mount();
    const radios = container.querySelectorAll<HTMLInputElement>('input[name="outreach-mode"]');
    await act(async () => { radios[1].click(); });
    await act(async () => { button(container, "Start autopilot").click(); });
    await act(async () => { await Promise.resolve(); });

    expect(container.textContent).toContain("blocked the WhatsApp window");
    expect(container.textContent).toContain("Resume");
    // Nothing was recorded for a chat that never opened.
    expect(contacted).toHaveLength(0);

    unmount();
  });
});
