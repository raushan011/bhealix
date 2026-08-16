/**
 * Whether a click is one that takes the browser to another page of this
 * application — the question the progress bar has to answer before it starts.
 *
 * Kept apart from the component, and pure, because getting it wrong is not
 * cosmetic in either direction. Answer yes too often and the bar starts for a
 * download or a new tab and then runs until its abandon timer, which looks
 * broken; answer no too often and the tap it was built for goes unacknowledged.
 * Both are conditions of a real click on a real anchor, so they are worth
 * testing directly rather than through a rendered tree.
 *
 * `from` is passed in rather than read off `window` so the current address is
 * an argument like any other.
 */
export function navigatesAway(event: MouseEvent, from: string): boolean {
  // Something ahead of us has already handled this click.
  if (event.defaultPrevented) return false;
  // Left button only. A middle click arrives as `auxclick`, but be explicit.
  if (event.button !== 0) return false;
  /*
   * A held modifier turns a click into something else — a new tab, a new
   * window, a saved target. The browser honours the modifier and this document
   * stays exactly where it is.
   */
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;

  /*
   * `closest`, not the target itself: a click almost always lands on the icon
   * or the label inside the link rather than on the anchor element.
   */
  const anchor = (event.target as Element | null)?.closest?.("a");
  if (!(anchor instanceof HTMLAnchorElement)) return false;

  // Anything but this frame opens elsewhere and leaves this page alone.
  if (anchor.target && anchor.target !== "_self") return false;
  // `download` saves the target; the document never changes.
  if (anchor.hasAttribute("download")) return false;

  // An anchor with no href is a placeholder; one starting `#` is a jump within
  // the page, which changes the address without loading anything.
  const href = anchor.getAttribute("href");
  if (!href || href.startsWith("#")) return false;

  let url: URL;
  let current: URL;
  try {
    url = new URL(anchor.href, from);
    current = new URL(from);
  } catch {
    return false;
  }

  // Another site. Whatever happens next is not ours to report on.
  if (url.origin !== current.origin) return false;
  /*
   * `/api` is never a page. The doctor export and the invoice PDF are ordinary
   * anchors pointing at a route handler, and the browser answers them by saving
   * or displaying a file — this document does not change, so nothing would
   * arrive to stop the bar.
   */
  if (url.pathname.startsWith("/api/")) return false;

  /*
   * A link to where we already are is not a journey. The query counts as part
   * of the address: a filter written into it loads a genuinely different page,
   * while a bare `#section` on the current path does not.
   */
  return url.pathname !== current.pathname || url.search !== current.search;
}
