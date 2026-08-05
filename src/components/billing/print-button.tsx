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
    // A moment's grace so the sheet is laid out before the dialog measures it.
    const timer = setTimeout(() => window.print(), 400);
    return () => clearTimeout(timer);
  }, []);

  return <button onClick={() => window.print()}
    className="inline-flex min-h-[44px] items-center gap-2 rounded-[10px] bg-[var(--brand)] px-4 text-sm font-semibold text-white">
    <Printer size={16} />Print / Save as PDF
  </button>;
}
