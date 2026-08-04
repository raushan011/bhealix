/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
// Default import kept in scope: vitest compiles this file with the classic JSX
// transform, which emits React.createElement.
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Modal } from "./modal";

// Driven through react-dom directly: @testing-library/react is listed in the
// project but its @testing-library/dom peer is not installed, and a test is a
// poor reason to grow the dependency tree.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(ui: React.ReactElement) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(ui));
  return { container, unmount: () => { act(() => root.unmount()); container.remove(); } };
}

const dialog = () => document.querySelector("[role='dialog']");

describe("Modal", () => {
  /*
   * The bug this guards against is invisible to jsdom, which has no layout:
   * an ancestor carrying a transform becomes the containing block for
   * `position: fixed`, so a dialog nested in the page tree centres itself in
   * that box and hangs off the top of the screen. What can be asserted is the
   * structural invariant that prevents it — the dialog must escape the page
   * tree entirely, whatever the layout above it is doing.
   */
  it("renders outside the page tree, beyond the reach of ancestor transforms", () => {
    const { container, unmount } = mount(
      <div className="page-enter">
        <Modal title="Add employee" onClose={() => {}}><p>form</p></Modal>
      </div>
    );

    expect(dialog()).not.toBeNull();
    expect(container.contains(dialog())).toBe(false);
    expect(document.body.contains(dialog())).toBe(true);
    unmount();
  });

  it("restores page scrolling once it closes", () => {
    const { unmount } = mount(<Modal title="Add employee" onClose={() => {}}><p>form</p></Modal>);
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).not.toBe("hidden");
  });
});
