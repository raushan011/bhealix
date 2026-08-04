"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

/**
 * Registers /sw.js and offers the update rather than forcing it.
 *
 * A silent takeover would swap the build out from under a rep who is halfway
 * through a visit form, so the new worker waits until this banner is tapped.
 */
export function ServiceWorker() {
  const [updateReady, setUpdateReady] = useState(false);
  const reloadOnTakeover = useRef(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      // A worker left behind by a production build would keep serving its own
      // fingerprinted chunks to the dev server, which reads as a broken app.
      void navigator.serviceWorker.getRegistrations().then(all => all.forEach(one => one.unregister()));
      return;
    }

    // clients.claim() also fires this on the very first install, so only the
    // banner's own request is allowed to reload the page.
    const onControllerChange = () => { if (reloadOnTakeover.current) window.location.reload(); };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    void navigator.serviceWorker.register("/sw.js").then(registration => {
      const watch = (worker: ServiceWorker | null) => {
        if (!worker) return;
        // Only a page that already has a controller is seeing an *update*.
        const check = () => { if (worker.state === "installed" && navigator.serviceWorker.controller) setUpdateReady(true); };
        check();
        worker.addEventListener("statechange", check);
      };
      watch(registration.waiting);
      registration.addEventListener("updatefound", () => watch(registration.installing));
    }).catch(() => { /* Offline support is a bonus; never break the page over it. */ });

    return () => navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
  }, []);

  const applyUpdate = useCallback(async () => {
    reloadOnTakeover.current = true;
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration?.waiting) registration.waiting.postMessage("SKIP_WAITING");
    else window.location.reload();
  }, []);

  if (!updateReady) return null;

  return <div className="flex items-center justify-center gap-3 bg-[var(--brand-soft)] px-4 py-2 text-[13px] text-[var(--ink-2)]">
    <span>A new version of BHEALIX is ready.</span>
    <button onClick={applyUpdate} className="inline-flex items-center gap-1.5 font-semibold text-[var(--brand)] underline underline-offset-2">
      <RefreshCw size={13} />Reload
    </button>
  </div>;
}
