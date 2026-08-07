"use client";

import { useEffect } from "react";
import { Printer } from "lucide-react";

/**
 * Printing is what produces the PDF: every browser this app runs in offers
 * "Save as PDF" as a destination, on desktop and on both mobile platforms.
 *
 * `?auto=1` opens the dialog on arrival, so the download button elsewhere in
 * the app is a single tap rather than a page plus a second press. Read off
 * `location` rather than `useSearchParams` so this component never drags a
 * Suspense requirement into whatever page hosts it.
 */
export function PrintButton() {
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("auto") !== "1") return;

    let done = false;
    const print = () => { if (!done) { done = true; window.print(); } };

    /*
      A moment's grace so the sheet is laid out before the dialog measures it,
      and then the payment QR: an image still in flight when the dialog opens
      comes out of the PDF as a blank square, and a bill with a hole where the
      code should be is worse than one printed a second later. The timer is the
      backstop for an image that never arrives at all.
    */
    const settled = Array.from(document.images).map(image => image.complete
      ? Promise.resolve()
      : new Promise<void>(resolve => {
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => resolve(), { once: true });
        }));

    let timer = setTimeout(print, 2500);
    Promise.all(settled).then(() => {
      clearTimeout(timer);
      timer = setTimeout(print, 400);
    });
    return () => { done = true; clearTimeout(timer); };
  }, []);

  return <button onClick={() => window.print()}
    className="inline-flex min-h-[44px] items-center gap-2 rounded-[10px] bg-[var(--brand)] px-4 text-sm font-semibold text-white">
    <Printer size={16} />Print / Save as PDF
  </button>;
}
