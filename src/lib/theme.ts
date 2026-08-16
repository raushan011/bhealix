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
 * Repaints the browser's own chrome — the phone's status bar, the desktop tab
 * strip — to match what was just chosen.
 *
 * The document ships with two `theme-color` tags keyed to `prefers-color-scheme`,
 * which is the right answer before any JavaScript runs and the wrong one after:
 * they know nothing of an overruled device or of a palette, so a monochrome page
 * on a light phone kept a walnut bar above it.
 *
 * The colour is read back off the root element rather than restated here, so the
 * stylesheet stays the only place a palette is defined. Both original tags are
 * removed instead of edited: a browser takes the *first* `theme-color` whose
 * media matches, so leaving them in place would let one of them win.
 */
export function paintBrowserChrome() {
  const styles = getComputedStyle(document.documentElement);
  // The brand fills the bar in light and would glare in dark, where the page's
  // own background is the quieter and more honest answer.
  const dark = styles.getPropertyValue("color-scheme").trim() === "dark";
  const colour = styles.getPropertyValue(dark ? "--bg" : "--brand").trim();
  if (!colour) return;

  for (const tag of document.querySelectorAll('meta[name="theme-color"][media]')) tag.remove();

  let tag = document.querySelector('meta[name="theme-color"]:not([media])');
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute("name", "theme-color");
    document.head.appendChild(tag);
  }
  tag.setAttribute("content", colour);
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
 * It deliberately does not touch `theme-color`. The static tags in the head are
 * already a reasonable answer at this instant, and the accurate one needs
 * computed styles that do not exist until the stylesheet has been applied.
 */
export const THEME_SCRIPT = `try{` +
  `var d=document.documentElement;` +
  `var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});` +
  `if(t==="dark"||t==="light")d.setAttribute("data-theme",t);` +
  `var p=localStorage.getItem(${JSON.stringify(PALETTE_KEY)});` +
  `if(p==="mono")d.setAttribute("data-palette",p);` +
  `}catch(e){}`;
