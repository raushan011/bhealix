/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import {
  PALETTE_KEY, THEME_KEY, THEME_SCRIPT, applyPalette, applyTheme, paintBrowserChrome,
  readPalette, readTheme, resolveTheme
} from "./theme";

const root = () => document.documentElement;
const chrome = () => document.querySelector('meta[name="theme-color"]');

beforeEach(() => {
  localStorage.clear();
  root().removeAttribute("data-theme");
  root().removeAttribute("data-palette");
  document.head.innerHTML = "";
});

describe("the mode", () => {
  it("starts by following the device", () => {
    expect(readTheme()).toBe("system");
    expect(root().hasAttribute("data-theme")).toBe(false);
  });

  it("marks the root and remembers a choice", () => {
    applyTheme("dark");
    expect(root().getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
    expect(readTheme()).toBe("dark");
  });

  /**
   * Going back to the device is the *absence* of a mark, not a third value —
   * the CSS gives `[data-theme]` precedence over `prefers-color-scheme`, so a
   * lingering attribute would pin somebody to whatever they last picked.
   */
  it("clears both the mark and the memory when handed back to the device", () => {
    applyTheme("light");
    applyTheme("system");
    expect(root().hasAttribute("data-theme")).toBe(false);
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
    expect(readTheme()).toBe("system");
  });

  it("ignores a stored value that is not a mode", () => {
    localStorage.setItem(THEME_KEY, "chartreuse");
    expect(readTheme()).toBe("system");
  });

  it("resolves an explicit choice without asking the device", () => {
    expect(resolveTheme("dark")).toBe("dark");
    expect(resolveTheme("light")).toBe("light");
  });
});

describe("the palette", () => {
  it("starts at the brand's own, unmarked", () => {
    expect(readPalette()).toBe("original");
    expect(root().hasAttribute("data-palette")).toBe(false);
  });

  it("marks the root and remembers black and white", () => {
    applyPalette("mono");
    expect(root().getAttribute("data-palette")).toBe("mono");
    expect(localStorage.getItem(PALETTE_KEY)).toBe("mono");
    expect(readPalette()).toBe("mono");
  });

  it("clears the mark going back to the original", () => {
    applyPalette("mono");
    applyPalette("original");
    expect(root().hasAttribute("data-palette")).toBe(false);
    expect(localStorage.getItem(PALETTE_KEY)).toBeNull();
    expect(readPalette()).toBe("original");
  });

  it("ignores a stored value that is not a palette", () => {
    localStorage.setItem(PALETTE_KEY, "neon");
    expect(readPalette()).toBe("original");
  });

  /**
   * The two axes are the whole design: somebody wants monochrome at night as
   * much as at noon, and choosing one must never quietly answer the other.
   */
  it("leaves the mode alone, and is left alone by it", () => {
    applyTheme("dark");
    applyPalette("mono");
    expect(root().getAttribute("data-theme")).toBe("dark");
    expect(root().getAttribute("data-palette")).toBe("mono");

    applyPalette("original");
    expect(readTheme()).toBe("dark");

    applyTheme("system");
    applyPalette("mono");
    applyTheme("light");
    expect(readPalette()).toBe("mono");
  });
});

describe("the script that runs before the first paint", () => {
  const run = () => new Function(THEME_SCRIPT)();

  it("restores both marks", () => {
    localStorage.setItem(THEME_KEY, "dark");
    localStorage.setItem(PALETTE_KEY, "mono");
    run();
    expect(root().getAttribute("data-theme")).toBe("dark");
    expect(root().getAttribute("data-palette")).toBe("mono");
  });

  it("restores one without the other", () => {
    localStorage.setItem(PALETTE_KEY, "mono");
    run();
    expect(root().hasAttribute("data-theme")).toBe(false);
    expect(root().getAttribute("data-palette")).toBe("mono");
  });

  it("marks nothing when nothing was chosen", () => {
    run();
    expect(root().hasAttribute("data-theme")).toBe(false);
    expect(root().hasAttribute("data-palette")).toBe(false);
  });

  it("refuses a stored value it does not recognise", () => {
    localStorage.setItem(THEME_KEY, "system");
    localStorage.setItem(PALETTE_KEY, "original");
    run();
    expect(root().hasAttribute("data-theme")).toBe(false);
    expect(root().hasAttribute("data-palette")).toBe(false);
  });

  /** Storage throws outright in a locked-down browser, and a theme is not worth a blank page. */
  it("survives storage being unavailable", () => {
    const stored = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() { throw new Error("denied"); }
    });
    expect(run).not.toThrow();
    if (stored) Object.defineProperty(window, "localStorage", stored);
  });
});

describe("the browser's own chrome", () => {
  /**
   * The document ships two `theme-color` tags keyed to `prefers-color-scheme`,
   * which is right before any script runs and wrong afterwards — they know
   * nothing of an overruled device or of the palette. A browser takes the first
   * tag whose media matches, so they have to go rather than be edited around.
   */
  it("replaces the media-keyed tags with one that has the last word", () => {
    document.head.innerHTML =
      '<meta name="theme-color" media="(prefers-color-scheme: light)" content="#73461f">' +
      '<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#15110d">';

    root().style.setProperty("color-scheme", "light");
    root().style.setProperty("--brand", "#111113");
    paintBrowserChrome();

    expect(document.querySelectorAll('meta[name="theme-color"]')).toHaveLength(1);
    expect(chrome()?.getAttribute("media")).toBeNull();
    expect(chrome()?.getAttribute("content")).toBe("#111113");
  });

  it("takes the page's own background in dark, where the brand would glare", () => {
    root().style.setProperty("color-scheme", "dark");
    root().style.setProperty("--brand", "#f4f4f5");
    root().style.setProperty("--bg", "#0b0b0c");
    paintBrowserChrome();
    expect(chrome()?.getAttribute("content")).toBe("#0b0b0c");
  });

  it("repaints the same tag rather than stacking a new one each time", () => {
    root().style.setProperty("color-scheme", "light");
    root().style.setProperty("--brand", "#73461f");
    paintBrowserChrome();
    root().style.setProperty("--brand", "#111113");
    paintBrowserChrome();

    expect(document.querySelectorAll('meta[name="theme-color"]')).toHaveLength(1);
    expect(chrome()?.getAttribute("content")).toBe("#111113");
  });

  it("leaves the head alone when the stylesheet has not landed yet", () => {
    root().style.removeProperty("--brand");
    root().style.setProperty("color-scheme", "light");
    paintBrowserChrome();
    expect(chrome()).toBeNull();
  });
});
