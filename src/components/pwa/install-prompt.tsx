"use client";

import { useEffect, useState } from "react";
import { Share, Smartphone, X } from "lucide-react";

/** Chrome/Edge hand us the banner to fire ourselves; the type isn't in lib.dom. */
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

const DISMISSED_KEY = "bhealix.install-dismissed";
const SNOOZE_DAYS = 30;

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  // iOS never adopted display-mode for home-screen apps.
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

function snoozed() {
  try {
    const at = Number(localStorage.getItem(DISMISSED_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < SNOOZE_DAYS * 86_400_000;
  } catch {
    return false; // Private mode without storage: just show it.
  }
}

/**
 * Reps live on their phones, so installing is worth one nudge — but only one.
 * Android gets the real install button; iOS only ever gets instructions,
 * because Safari has no programmatic install.
 *
 * Both panels use this. The dismissal is shared on purpose: somebody who has
 * said no once should not be asked again just because they opened the other
 * side of the app.
 */
export function InstallPrompt({ description = "Add it to your home screen for full-screen access between calls." }:
  { description?: string } = {}) {
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null);
  const [showIosHelp, setShowIosHelp] = useState(false);

  useEffect(() => {
    if (isStandalone() || snoozed()) return;

    if (isIos()) { setShowIosHelp(true); return; }

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    // Chrome fires this after a successful install; drop the card immediately.
    const onInstalled = () => setInstallEvent(null);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  function dismiss() {
    try { localStorage.setItem(DISMISSED_KEY, String(Date.now())); } catch { /* nothing to remember it with */ }
    setInstallEvent(null);
    setShowIosHelp(false);
  }

  async function install() {
    if (!installEvent) return;
    await installEvent.prompt();
    await installEvent.userChoice;
    // The event is single-use whichever way they answered.
    setInstallEvent(null);
  }

  if (!installEvent && !showIosHelp) return null;

  return <section className="card mb-4 flex items-start gap-3 border-[var(--line-2)] bg-[var(--surface-2)] p-3.5">
    <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-[var(--brand)] text-[var(--on-brand)]"><Smartphone size={17} /></span>
    <div className="min-w-0 flex-1">
      <p className="text-sm font-semibold">Install BHEALIX</p>
      {showIosHelp
        ? <p className="mt-0.5 text-[13px] text-[var(--muted)]">
            Tap <Share size={12} className="inline align-[-1px]" /> Share, then <span className="font-medium text-[var(--ink-2)]">Add to Home Screen</span>.
          </p>
        : <>
            <p className="mt-0.5 text-[13px] text-[var(--muted)]">{description}</p>
            <button onClick={install} className="mt-2.5 inline-flex min-h-[36px] items-center rounded-[10px] bg-[var(--brand)] px-3.5 text-[13px] font-semibold text-[var(--on-brand)] hover:bg-[var(--brand-hover)]">
              Install
            </button>
          </>}
    </div>
    <button onClick={dismiss} aria-label="Dismiss" className="tap -m-1 grid shrink-0 place-items-center rounded-[10px] text-[var(--muted)] hover:bg-[var(--surface)]"><X size={16} /></button>
  </section>;
}
