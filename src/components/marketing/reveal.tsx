"use client";

import { useEffect } from "react";

/**
 * Lets sections settle in as they scroll into view.
 *
 * Purely additive: the stylesheet only hides a `.reveal` once this has stamped
 * `data-js` on the page, so without JavaScript — or with reduced motion — every
 * section is simply visible. Anything already on screen is revealed at once.
 */
export function Reveal({ root }: { root: string }) {
  useEffect(() => {
    const page = document.querySelector<HTMLElement>(`.${root}`);
    if (!page) return;
    const targets = Array.from(page.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (!("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    page.setAttribute("data-js", "");
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.setAttribute("data-in", "");
        observer.unobserve(entry.target);
      }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    targets.forEach(target => observer.observe(target));
    // Belt and braces: whatever the observer has not reached in a few seconds
    // is shown anyway. A section that never appears is worse than one that
    // appears without its entrance.
    const fallback = window.setTimeout(() => targets.forEach(target => target.setAttribute("data-in", "")), 5000);
    return () => { observer.disconnect(); window.clearTimeout(fallback); };
  }, [root]);

  return null;
}
