"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The same bar as `NavigationProgress`, for the presses that do not navigate:
 * Save, Delete, Book, Refresh, Send — every button that asks the server for
 * something and waits.
 *
 * The kit's `Button` already spins while its own handler runs, but plenty of
 * buttons are not the kit's — icon buttons, chips, row actions — and threading
 * a busy flag through each is the job that never gets finished. So this watches
 * the requests themselves: one wrapper round `fetch`, installed once, covering
 * every button there is and every one added later.
 *
 * Only requests a person caused are shown. A write (anything but GET) always
 * counts; a read counts when it began just after a tap or Enter, which is what
 * a Refresh or a filter is. Background reads — the order form's pin-code check,
 * a dashboard's polling — start on their own and are left out, so the bar
 * means "you did something and it is being done" and nothing else.
 */

/** A read started this soon after a press is the press's doing. */
const PRESS_WINDOW_MS = 800;
/** Shorter waits than this are not worth a bar — it would only flicker. */
const SHOW_AFTER_MS = 150;
const CEILING = 92;

type Listener = (count: number) => void;
const listeners = new Set<Listener>();
let inFlight = 0;
let lastPress = 0;
let installed = false;

function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const press = () => { lastPress = Date.now(); };
  document.addEventListener("pointerdown", press, true);
  document.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") press(); }, true);

  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const ours = url.startsWith("/api/") || url.startsWith(`${window.location.origin}/api/`);
    const counted = ours && (method !== "GET" || Date.now() - lastPress < PRESS_WINDOW_MS);
    if (!counted) return original(input, init);

    inFlight++;
    listeners.forEach(listener => listener(inFlight));
    return original(input, init).finally(() => {
      inFlight = Math.max(0, inFlight - 1);
      listeners.forEach(listener => listener(inFlight));
    });
  };
}

export function RequestProgress() {
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const timers = useRef<{ show?: ReturnType<typeof setTimeout>; creep?: ReturnType<typeof setInterval>; hide?: ReturnType<typeof setTimeout> }>({});

  useEffect(() => {
    install();
    const t = timers.current;
    const clear = () => { clearTimeout(t.show); clearInterval(t.creep); clearTimeout(t.hide); };

    const onChange: Listener = count => {
      if (count > 0) {
        if (t.show || t.creep) return;
        clearTimeout(t.hide);
        t.show = setTimeout(() => {
          setVisible(true);
          setProgress(10);
          t.creep = setInterval(() => setProgress(current => current >= CEILING ? current : current + (CEILING - current) * 0.12), 180);
        }, SHOW_AFTER_MS);
        return;
      }
      clear();
      t.show = undefined; t.creep = undefined;
      setProgress(current => (current > 0 ? 100 : 0));
      t.hide = setTimeout(() => { setVisible(false); setProgress(0); }, 280);
    };

    listeners.add(onChange);
    return () => { listeners.delete(onChange); clear(); };
  }, []);

  if (!visible) return null;
  return <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-50 h-[3px] print:hidden">
    <div className="h-full bg-[var(--brand)] transition-[width,opacity] duration-200 ease-out"
      style={{ width: `${progress}%`, opacity: progress >= 100 ? 0 : 1, boxShadow: "0 0 8px var(--brand)" }} />
  </div>;
}
