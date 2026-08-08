/**
 * Light and dark, and how the choice survives a reload.
 *
 * Three states, not two: until somebody picks, the app follows the device — a
 * rep whose phone turns dark at sunset should not have to be told. Once they
 * pick, that beats the device until they pick again, which is why the choice is
 * written to the root element as well as to storage: the CSS gives
 * `[data-theme]` precedence over the `prefers-color-scheme` block.
 */

export type Theme = "light" | "dark" | "system";

export const THEME_KEY = "bhealix-theme";

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

/** Applies a choice and remembers it. "system" removes both the mark and the memory. */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") {
    root.removeAttribute("data-theme");
    window.localStorage?.removeItem(THEME_KEY);
  } else {
    root.setAttribute("data-theme", theme);
    window.localStorage?.setItem(THEME_KEY, theme);
  }
}

/**
 * The same decision, small enough to run before the first paint.
 *
 * This goes into the document head as a blocking script. React cannot do this
 * job: by the time the app has hydrated, a cream page has already been painted,
 * and somebody who chose dark sees it flash white on every navigation to a
 * fresh document. Wrapped in try/catch because storage throws outright in a
 * locked-down browser, and a theme is not worth a blank page.
 */
export const THEME_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(t==="dark"||t==="light")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;
