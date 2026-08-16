"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { navigatesAway } from "./navigates";

/**
 * The bar across the top of every screen that says a tap was heard.
 *
 * `loading.tsx` covers the wait once React has begun a transition, but not the
 * gap before it — the router still has to fetch the next route's payload, and
 * on a phone that gap is the whole of what people experience. Nothing moved,
 * so the tap looked lost, so the link got pressed again.
 *
 * This starts on the click itself rather than on any router state, which is
 * why it is driven by a DOM listener rather than `useLinkStatus`. There are 124
 * links across the three panels and more inside the pages; one listener in the
 * capture phase covers all of them and every one added later, where the hook
 * would have to be threaded through each by hand.
 *
 * It is deliberately not a spinner in the middle of the screen. A spinner
 * blocks and says "wait"; a line creeping along the top says "this is
 * happening" while leaving the page readable and the interface usable.
 */

/** How far the bar creeps while waiting. It must never reach the end on its own. */
const CEILING = 92;

export function NavigationProgress() {
  const pathname = usePathname();
  const search = useSearchParams();

  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);

  /*
   * Whether a navigation is in flight, held in a ref rather than read back off
   * `visible`. The bar stays mounted for a moment after finishing so it can be
   * seen reaching the end, so "on screen" and "still waiting" are two different
   * questions and only this one decides whether `finish` has work to do.
   */
  const running = useRef(false);
  const creep = useRef<ReturnType<typeof setInterval> | null>(null);
  const cleanup = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abandon = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (creep.current) { clearInterval(creep.current); creep.current = null; }
    if (cleanup.current) { clearTimeout(cleanup.current); cleanup.current = null; }
    if (abandon.current) { clearTimeout(abandon.current); abandon.current = null; }
  }, []);

  const finish = useCallback(() => {
    if (!running.current) return;
    running.current = false;
    clearTimers();
    setProgress(100);
    // Long enough for the bar to be seen reaching the end before it goes.
    cleanup.current = setTimeout(() => { setVisible(false); setProgress(0); }, 280);
  }, [clearTimers]);

  const start = useCallback(() => {
    clearTimers();
    running.current = true;
    setVisible(true);
    setProgress(8);
    /*
     * Decelerating rather than linear. A bar that advances steadily and then
     * stops dead at 92 reads as stuck; one that slows as it goes reads as
     * working hard on something nearly finished, which is the right impression
     * for a wait whose length cannot be known in advance.
     */
    creep.current = setInterval(() => {
      setProgress(current => (current >= CEILING ? current : current + (CEILING - current) * 0.12));
    }, 180);
    /*
     * Not every click that looks like a navigation becomes one. A guard can
     * redirect to the page already open, a request can fail, a download can
     * begin without the document ever changing. Without this the bar would sit
     * at 92 until the next navigation, and a bar that never finishes is worse
     * than one that never appeared.
     */
    abandon.current = setTimeout(finish, 12000);
  }, [clearTimers, finish]);

  /*
   * Arrival. Both halves of the address are watched because a screen can be
   * navigated to without its path changing — a filter written into the query is
   * a new page as far as anybody waiting for it is concerned.
   *
   * `finish` returns immediately when nothing is running, which is what makes
   * this safe to fire on mount and on every later render.
   */
  useEffect(() => { finish(); }, [pathname, search, finish]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (navigatesAway(event, window.location.href)) start();
    };
    // Back and forward are navigations nobody clicked a link for.
    const onPopState = () => start();

    // Capture, so a link whose own handler stops propagation is still counted.
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPopState);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPopState);
    };
  }, [start]);

  useEffect(() => clearTimers, [clearTimers]);

  if (!visible) return null;

  // Above the mobile menu at z-40, which is the highest thing the shells draw.
  return <div aria-hidden data-navigating className="pointer-events-none fixed inset-x-0 top-0 z-50 h-[3px] print:hidden">
    <div
      className="h-full bg-[var(--brand)] transition-[width,opacity] duration-200 ease-out"
      style={{
        width: `${progress}%`,
        // Fades only at the very end, so the bar is never seen vanishing mid-run.
        opacity: progress >= 100 ? 0 : 1,
        boxShadow: "0 0 8px var(--brand)"
      }}
    />
  </div>;
}
