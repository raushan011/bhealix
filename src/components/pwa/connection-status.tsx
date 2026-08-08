"use client";

import { useEffect, useState } from "react";
import { CloudOff } from "lucide-react";

/**
 * Nothing in this app works offline by design, so the honest thing to do is say
 * so the moment coverage drops instead of letting saves fail silently.
 *
 * Starts hidden on both server and client, then syncs in an effect, so there is
 * nothing for hydration to disagree about.
 */
export function ConnectionStatus() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  if (!offline) return null;

  return <div role="status" className="flex items-center justify-center gap-2 bg-[var(--warn-bg)] px-4 py-2 text-[13px] font-medium text-[var(--warn-ink)]">
    <CloudOff size={14} />You&apos;re offline — changes won&apos;t save until you reconnect.
  </div>;
}
