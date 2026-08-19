/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
// Default import kept in scope: vitest compiles this file with the classic JSX
// transform, which emits React.createElement.
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { blankCustomPayslip } from "@/lib/hr/custom-payslip";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({})
}));

import { CustomPayslipEditor } from "./custom-payslip-editor";

/**
 * The editor, driven through react-dom directly. What matters here is the one
 * promise the screen makes and no pure function can keep: that the sheet on
 * the right is redrawn from the form on the left — a company name from the
 * settings appears on it, and a figure typed into a row appears in its total.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let posted: unknown[] = [];

function stubFetch() {
  posted = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url);
    let body: unknown = { data: {} };
    if (path.startsWith("/api/hr/custom-payslips?blank=1")) {
      body = { data: { blank: blankCustomPayslip({ company: { tradeName: "BHEALIX", city: "Noida" }, signatoryName: "R. U.", month: "2026-07" }) } };
    } else if (path.startsWith("/api/team")) {
      body = { data: { items: [{ _id: "aaaaaaaaaaaaaaaaaaaaaaa1", name: "Asha Rao", employeeId: "E1", active: true }] } };
    } else if (path === "/api/hr/custom-payslips" && init?.method === "POST") {
      posted.push(JSON.parse(String(init.body)));
      body = { data: { item: { _id: "bbbbbbbbbbbbbbbbbbbbbbb1", ...JSON.parse(String(init.body)) } } };
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }));
}

async function mount() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => { root.render(<CustomPayslipEditor />); });
  // Let the two opening fetches settle and the form appear.
  await act(async () => { await Promise.resolve(); });
  return { container, unmount: () => { act(() => root.unmount()); container.remove(); } };
}

const setValue = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ""; });

describe("the custom payslip editor", () => {
  it("opens on the company's own sheet and redraws the preview as figures are typed", async () => {
    stubFetch();
    const { container, unmount } = await mount();

    const sheet = container.querySelector("article.payslip-sheet")!;
    expect(sheet).toBeTruthy();
    expect(sheet.textContent).toContain("BHEALIX");
    expect(sheet.textContent).toContain("Payslip for July 2026");
    expect(sheet.textContent).toContain("R. U.");

    // The first amount box on the form is Basic — type a figure and the sheet's gross follows.
    const amount = container.querySelector<HTMLInputElement>('input[type="number"].text-right')!;
    await act(async () => { setValue(amount, "25000"); });
    expect(sheet.textContent).toContain("₹25,000");
    expect(sheet.textContent).toContain("Twenty");

    unmount();
  });

  it("sends the sheet as typed, with empty rows dropped, when saved", async () => {
    stubFetch();
    const { container, unmount } = await mount();

    const amount = container.querySelector<HTMLInputElement>('input[type="number"].text-right')!;
    await act(async () => { setValue(amount, "18000"); });
    const save = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Save draft"))!;
    await act(async () => { save.click(); });
    await act(async () => { await Promise.resolve(); });

    expect(posted).toHaveLength(1);
    const body = posted[0] as { earnings: Array<{ name: string; amount: number }>; details: Array<{ label: string; value: string }>; status: string; title: string };
    expect(body.status).toBe("Draft");
    expect(body.title).toBe("Payslip");
    expect(body.earnings).toEqual([{ name: "Basic", amount: 18_000 }, { name: "House rent allowance", amount: 0 }]);
    // Labelled-but-empty lines are kept, so the block can be filled in later; the sheet does not print them.
    expect(body.details.length).toBe(8);
    expect(body.details[0]).toEqual({ label: "Name", value: "" });

    unmount();
  });

  it("clears the Duplicate watermark when another kind is chosen, but never a typed one", async () => {
    stubFetch();
    const { container, unmount } = await mount();
    const sheet = container.querySelector("article.payslip-sheet")!;
    const chip = (label: string) =>
      Array.from(container.querySelectorAll("button")).find(button => button.textContent === label)!;
    const watermark = () =>
      Array.from(container.querySelectorAll<HTMLInputElement>("input")).find(input => input.maxLength === 30)!;

    // Tapping Duplicate writes the mark and lights only that chip.
    await act(async () => { chip("Duplicate").click(); });
    expect(watermark().value).toBe("Duplicate");
    expect(sheet.textContent).toContain("Duplicate");
    expect(chip("Duplicate").getAttribute("aria-pressed")).toBe("true");
    expect(chip("Payslip").getAttribute("aria-pressed")).toBe("false");

    // Switching kind takes the mark with it — a plain payslip is not a duplicate.
    await act(async () => { chip("Payslip").click(); });
    expect(watermark().value).toBe("");
    expect(chip("Payslip").getAttribute("aria-pressed")).toBe("true");
    expect(chip("Duplicate").getAttribute("aria-pressed")).toBe("false");

    // A watermark somebody typed themselves survives switching kinds.
    await act(async () => { setValue(watermark(), "SPECIMEN"); });
    await act(async () => { chip("Arrears").click(); });
    expect(watermark().value).toBe("SPECIMEN");

    unmount();
  });
});
