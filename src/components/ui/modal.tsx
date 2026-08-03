"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

/**
 * Bottom sheet on phones, centred dialog on desktop — one component so every
 * overlay in the app behaves the same way on both form factors.
 */
export function Modal({ title, description, onClose, footer, children }: {
  title: string;
  description?: string;
  onClose: () => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) { if (event.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = previous; };
  }, [onClose]);

  return <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
    <button aria-label="Close" tabIndex={-1} onClick={onClose} className="absolute inset-0 cursor-default" />
    <div role="dialog" aria-modal="true" aria-label={title}
      className="relative flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white sm:max-w-lg sm:rounded-2xl">
      <div className="flex items-start justify-between gap-3 border-b border-[var(--line)] px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-[var(--muted)]">{description}</p>}
        </div>
        <button onClick={onClose} aria-label="Close" className="tap -mr-2 -mt-2 grid shrink-0 place-items-center rounded-[10px] text-[var(--muted)] hover:bg-[var(--surface-2)]"><X size={18} /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      {footer && <div className="border-t border-[var(--line)] px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</div>}
    </div>
  </div>;
}
