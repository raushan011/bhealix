/**
 * How the app looks, and how the choice survives a reload.
 *
 * Two independent axes, not one list of themes. *Mode* — light, dark, or follow
 * the device — answers how bright the room is. *Palette* — the brand's warm
 * cream, or black and white — answers whether somebody wants the brand on
 * screen at all. Crossing them into four named themes would mean a rep who
 * switches to monochrome silently loses the sunset handover, which is exactly
 * the thing neither choice should cost the other.
 *
 * Three mode states rather than two: until somebody picks, the app follows the
 * device. Once they pick, that beats the device until they pick again, which is
 * why each choice is written to the root element as well as to storage — the CSS
 * gives the attributes precedence over the `prefers-color-scheme` blocks.
 */

export type Theme = "light" | "dark" | "system";

/** The warm brand palette, or greyscale. `original` is the default and the absence of a mark. */
export type Palette = "original" | "mono";

export const THEME_KEY = "bhealix-theme";
export const PALETTE_KEY = "bhealix-palette";

/** What is actually on screen, once the device has had its say. */
export function resolveTheme(theme: Theme): "light" | "dark" {
  if (theme !== "system") return theme;
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark" : "light";
}

export function readTheme(): Theme {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage?.getItem(THEME_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

export function readPalette(): Palette {
  if (typeof window === "undefined") return "original";
  return window.localStorage?.getItem(PALETTE_KEY) === "mono" ? "mono" : "original";
}

/** Applies a mode and remembers it. "system" removes both the mark and the memory. */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") {
    root.removeAttribute("data-theme");
    window.localStorage?.removeItem(THEME_KEY);
  } else {
    root.setAttribute("data-theme", theme);
    window.localStorage?.setItem(THEME_KEY, theme);
  }
  paintBrowserChrome();
}

/** The same, for the palette. "original" is the absence of a choice, so it clears both. */
export function applyPalette(palette: Palette) {
  const root = document.documentElement;
  if (palette === "original") {
    root.removeAttribute("data-palette");
    window.localStorage?.removeItem(PALETTE_KEY);
  } else {
    root.setAttribute("data-palette", palette);
    window.localStorage?.setItem(PALETTE_KEY, palette);
  }
  paintBrowserChrome();
}

/**
 * The colour of the browser's chrome before the stylesheet has been applied,
 * for each of the four combinations the script below can tell apart.
 *
 * A duplicate of what the stylesheet says, and unavoidably so: this is needed
 * by a script that runs before there is a stylesheet to ask. It is only ever
 * the opening answer — `paintBrowserChrome` reads the real value off the root
 * element the moment the page is up, and everything after that comes from CSS.
 *
 * The pairs follow the same rule that function does: the brand fills the bar in
 * light, and in dark the page's own background does.
 */
const CHROME = {
  "original-light": "#73461f",
  "original-dark": "#15110d",
  "mono-light": "#111113",
  "mono-dark": "#0b0b0c"
} as const;

/** Find the one `theme-color` tag, or make it. Nothing else may own one. */
function chromeTag() {
  const existing = document.querySelector('meta[name="theme-color"]');
  if (existing) return existing;
  const tag = document.createElement("meta");
  tag.setAttribute("name", "theme-color");
  document.head.appendChild(tag);
  return tag;
}

/**
 * Repaints the browser's own chrome — the phone's status bar, the desktop tab
 * strip — to match what was just chosen.
 *
 * The colour is read back off the root element rather than restated here, so
 * the stylesheet stays the only place a palette is defined. A device following
 * `prefers-color-scheme` has already had its say by then, and so has the
 * palette, which is why one tag with no `media` is the whole story.
 *
 * There is exactly one such tag and this file owns it, put there by the script
 * below before the first paint. That ownership is the point rather than a
 * detail: it used to be two tags rendered by React from the `viewport` export,
 * which this function deleted in order to have the last word — and deleting a
 * node React believes it is managing is how React ends up calling `removeChild`
 * on a parent that is no longer there. It threw on the next navigation, the
 * route never committed, and the address bar changed while the page did not.
 * Every client-side navigation in the application broke the moment anybody's
 * theme was applied. Nothing here removes a node any more.
 */
export function paintBrowserChrome() {
  const styles = getComputedStyle(document.documentElement);
  // The brand fills the bar in light and would glare in dark, where the page's
  // own background is the quieter and more honest answer.
  const dark = styles.getPropertyValue("color-scheme").trim() === "dark";
  const colour = styles.getPropertyValue(dark ? "--bg" : "--brand").trim();
  if (!colour) return;

  chromeTag().setAttribute("content", colour);
}

/**
 * The same decisions, small enough to run before the first paint.
 *
 * This goes into the document head as a blocking script. React cannot do this
 * job: by the time the app has hydrated, a cream page has already been painted,
 * and somebody who chose dark sees it flash on every navigation to a fresh
 * document. Wrapped in try/catch because storage throws outright in a
 * locked-down browser, and a theme is not worth a blank page.
 *
 * It also writes the single `theme-color` tag, which used to come from the
 * `viewport` export instead. Two reasons for the move, and the second is the
 * important one. It is better: the tags Next rendered were keyed to
 * `prefers-color-scheme` and so knew nothing of an overruled device or of the
 * monochrome palette, where this runs after both have been read and gets all
 * four combinations right on the first paint. And it is safe: the tag now
 * belongs to this file from the moment it exists, so `paintBrowserChrome` can
 * keep it up to date by setting an attribute rather than by deleting something
 * React was managing — see the note there for what that cost.
 */
export const THEME_SCRIPT = `try{` +
  `var d=document.documentElement;` +
  `var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});` +
  `if(t==="dark"||t==="light")d.setAttribute("data-theme",t);` +
  `var p=localStorage.getItem(${JSON.stringify(PALETTE_KEY)});` +
  `if(p==="mono")d.setAttribute("data-palette",p);` +
  /*
   * The device only gets a say when nothing has been chosen over it, and only
   * where it can be asked — `matchMedia` is guarded for the same reason
   * `resolveTheme` guards it. Somewhere without it reads as light, which is
   * the same answer this script gave before it painted anything at all.
   */
  `var dark=t==="dark"||(t!=="light"&&!!window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches);` +
  `var m=document.createElement("meta");` +
  `m.setAttribute("name","theme-color");` +
  `m.setAttribute("content",${JSON.stringify(CHROME)}[(p==="mono"?"mono":"original")+(dark?"-dark":"-light")]);` +
  `document.head.appendChild(m);` +
  `}catch(e){}`;
