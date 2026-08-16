/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { navigatesAway } from "./navigates";

const origin = () => window.location.origin;

/**
 * A real click on a real element, judged where the component judges it.
 *
 * The predicate reads `event.target` and walks to the enclosing anchor, so the
 * event has to be dispatched rather than constructed — a hand-made object with
 * a `target` property would not exercise the part most likely to be wrong.
 *
 * The verdict is taken during the capture phase, which is where the component
 * listens, and a second listener behind it cancels the click so jsdom does not
 * try to follow the link and log a page of "navigation not implemented".
 */
function decide(node: Element, from: string, init: MouseEventInit = {}) {
  let verdict: boolean | undefined;
  const judge = (event: Event) => { verdict = navigatesAway(event as MouseEvent, from); };
  const swallow = (event: Event) => event.preventDefault();

  document.addEventListener("click", judge, true);
  document.addEventListener("click", swallow);
  node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init }));
  document.removeEventListener("click", judge, true);
  document.removeEventListener("click", swallow);

  if (verdict === undefined) throw new Error("no click reached the listener");
  return verdict;
}

/** An anchor in the document, with whatever attributes the case needs. */
function link(attributes: Record<string, string>, inner = "") {
  const anchor = document.createElement("a");
  for (const [name, value] of Object.entries(attributes)) anchor.setAttribute(name, value);
  anchor.innerHTML = inner;
  document.body.append(anchor);
  return anchor;
}

afterEach(() => { document.body.innerHTML = ""; });

describe("deciding whether a click starts a navigation", () => {
  it("says yes to an ordinary link to another page", () => {
    const anchor = link({ href: "/admin/doctors" });
    expect(decide(anchor, `${origin()}/admin`)).toBe(true);
  });

  /*
   * The common case, and the one a naive `event.target` check gets wrong: every
   * link in the shells wraps an icon and a label, so the element actually
   * clicked is almost never the anchor.
   */
  it("finds the link when the click lands on something inside it", () => {
    const anchor = link({ href: "/admin/visits" }, "<span><svg></svg>Visits</span>");
    const inner = anchor.querySelector("svg")!;
    expect(decide(inner, `${origin()}/admin`)).toBe(true);
  });

  it("says no to a link to the page already open", () => {
    const anchor = link({ href: "/admin/doctors" });
    expect(decide(anchor, `${origin()}/admin/doctors`)).toBe(false);
  });

  /*
   * The query is part of the address. A filter written into it loads a
   * genuinely different page and has to be reported as one.
   */
  it("counts a change of query on the same path as a navigation", () => {
    const anchor = link({ href: "/admin/doctors?missingCallTime=1" });
    expect(decide(anchor, `${origin()}/admin/doctors`)).toBe(true);
  });

  it("says no when only the fragment differs", () => {
    const anchor = link({ href: "#summary" });
    expect(decide(anchor, `${origin()}/admin/reports`)).toBe(false);
  });

  it("says no to an anchor with no href at all", () => {
    const anchor = link({});
    expect(decide(anchor, `${origin()}/admin`)).toBe(false);
  });

  /*
   * The doctor export. `download` means the browser saves the target and leaves
   * the page alone, so nothing would ever arrive to stop the bar.
   */
  it("says no to a download", () => {
    const anchor = link({ href: "/api/doctors/export", download: "" });
    expect(decide(anchor, `${origin()}/admin/doctors`)).toBe(false);
  });

  /** Belt and braces for the same case: a route handler is never a page. */
  it("says no to anything under /api, download attribute or not", () => {
    const anchor = link({ href: "/api/invoices/abc/pdf" });
    expect(decide(anchor, `${origin()}/admin/billing`)).toBe(false);
  });

  it("says no when the link opens a new tab", () => {
    const anchor = link({ href: "/admin/doctors", target: "_blank" });
    expect(decide(anchor, `${origin()}/admin`)).toBe(false);
  });

  it("says yes when the target is explicitly this frame", () => {
    const anchor = link({ href: "/admin/doctors", target: "_self" });
    expect(decide(anchor, `${origin()}/admin`)).toBe(true);
  });

  it("says no to another site", () => {
    const anchor = link({ href: "https://example.com/pricing" });
    expect(decide(anchor, `${origin()}/admin`)).toBe(false);
  });

  /*
   * Every one of these opens a tab or window and leaves this document exactly
   * where it was.
   */
  it.each(["metaKey", "ctrlKey", "shiftKey", "altKey"] as const)("says no to a %s click", modifier => {
    const anchor = link({ href: "/admin/doctors" });
    expect(decide(anchor, `${origin()}/admin`, { [modifier]: true })).toBe(false);
  });

  it("says no to anything but the left button", () => {
    const anchor = link({ href: "/admin/doctors" });
    expect(decide(anchor, `${origin()}/admin`, { button: 1 })).toBe(false);
  });

  /*
   * "Ahead of it" means earlier in the capture phase, which is the only place
   * anything can get in first — the component listens on the document going
   * down, so a link's own `onClick` runs long after the verdict is in. A
   * cancelled click there is one some outer guard has already dealt with.
   */
  it("says no when something ahead of it already handled the click", () => {
    const anchor = link({ href: "/admin/doctors" });
    const guard = (event: Event) => event.preventDefault();
    document.addEventListener("click", guard, true);
    try {
      expect(decide(anchor, `${origin()}/admin`)).toBe(false);
    } finally {
      document.removeEventListener("click", guard, true);
    }
  });

  it("says no to a click that missed every link on the page", () => {
    const button = document.createElement("button");
    document.body.append(button);
    expect(decide(button, `${origin()}/admin`)).toBe(false);
  });
});
