"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * Bottom sheet on phones, centred dialog on desktop — one component so every
 * overlay in the app behaves the same way on both form factors.
 *
 * Rendered into <body> rather than in place. `position: fixed` is measured
 * against the nearest ancestor holding a transform, filter or containment
 * rather than the viewport, so a dialog left inside the page tree silently
 * inherits whatever the layout above it happens to be doing — it centres
 * itself in that box and hangs off the top of the screen. Portalling puts it
 * out of reach of all of that for good.
 */
export function Modal({ title, description, onClose, footer, children }: {
  title: string;
  description?: string;
  onClose: () => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  // document only exists once we are on the client; nothing renders server-side.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) { if (event.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = previous; };
  }, [onClose]);

  if (!mounted) return null;

  return createPortal(
    <div className="fade-in fixed inset-0 z-50 flex items-end justify-center bg-[var(--overlay)] sm:items-center sm:p-4">
      <button aria-label="Close" tabIndex={-1} onClick={onClose} className="absolute inset-0 cursor-default" />
      <div role="dialog" aria-modal="true" aria-label={title}
        className="page-enter relative flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-[var(--surface)] shadow-xl sm:max-w-lg sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--line)] px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-[var(--muted)]">{description}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="tap -mr-2 -mt-2 grid shrink-0 place-items-center rounded-[10px] text-[var(--muted)] hover:bg-[var(--surface-2)]"><X size={18} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
        {footer && <div className="border-t border-[var(--line)] px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
