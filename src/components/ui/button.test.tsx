/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
// Default import kept in scope: vitest compiles this file with the classic JSX
// transform, which emits React.createElement.
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "./button";

// Driven through react-dom directly, matching modal.test.tsx: the project lists
// @testing-library/react but not its @testing-library/dom peer.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(ui: React.ReactElement) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(ui));
  const button = container.querySelector("button")!;
  return { button, root, container, unmount: () => { act(() => root.unmount()); container.remove(); } };
}

const click = (button: HTMLButtonElement) => act(() => { button.click(); });

/** A promise this test decides when to settle, standing in for a round trip. */
function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("a button that is working", () => {
  /**
   * The failure this exists to stop: a press, a second of nothing, and a second
   * press — a duplicate record on a form, and money moved twice on a payout.
   */
  it("disables itself for as long as an async handler is running", async () => {
    const gate = deferred();
    const { button, unmount } = mount(<Button onClick={() => gate.promise}>Save</Button>);

    expect(button.disabled).toBe(false);
    click(button);
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");

    await act(async () => { gate.resolve(); await gate.promise; });
    expect(button.disabled).toBe(false);
    expect(button.getAttribute("aria-busy")).toBeNull();
    unmount();
  });

  it("cannot be pressed a second time while the first press is in flight", async () => {
    const gate = deferred();
    let presses = 0;
    const { button, unmount } = mount(<Button onClick={() => { presses++; return gate.promise; }}>Save</Button>);

    click(button);
    click(button);
    click(button);
    expect(presses).toBe(1);

    await act(async () => { gate.resolve(); await gate.promise; });
    click(button);
    expect(presses).toBe(2);
    unmount();
  });

  /**
   * A handler that throws has still stopped working. Leaving the button
   * spinning would read as a hang even though the error notice is already on
   * screen underneath it.
   */
  it("stops working when the handler fails", async () => {
    const gate = deferred();
    const { button, unmount } = mount(<Button onClick={() => gate.promise.catch(() => {})}>Save</Button>);

    click(button);
    expect(button.disabled).toBe(true);

    await act(async () => { gate.reject(new Error("no")); await gate.promise.catch(() => {}); });
    expect(button.disabled).toBe(false);
    unmount();
  });

  /** Opening a dialog takes no time and must not flicker. */
  it("leaves a synchronous handler completely alone", () => {
    let opened = 0;
    const { button, unmount } = mount(<Button onClick={() => { opened++; }}>Open</Button>);

    click(button);
    expect(opened).toBe(1);
    expect(button.disabled).toBe(false);
    expect(button.getAttribute("aria-busy")).toBeNull();

    click(button);
    expect(opened).toBe(2);
    unmount();
  });

  /** A screen that disables its whole form while saving still wins. */
  it("honours an explicit busy flag on its own", () => {
    const { button, unmount } = mount(<Button busy>Saving</Button>);
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    unmount();
  });

  it("stays disabled when told to be, whatever it is doing", () => {
    const { button, unmount } = mount(<Button disabled onClick={() => Promise.resolve()}>Save</Button>);
    expect(button.disabled).toBe(true);
    unmount();
  });

  /**
   * The common shape in this app: a handler that closes the dialog it lives in.
   * The button is gone by the time the promise settles, so settling must not
   * reach for state that no longer exists.
   */
  it("survives being unmounted before its handler settles", async () => {
    const gate = deferred();
    const { button, unmount } = mount(<Button onClick={() => gate.promise}>Save</Button>);

    click(button);
    unmount();
    await act(async () => { gate.resolve(); await gate.promise; });
    expect(button.isConnected).toBe(false);
  });
});
