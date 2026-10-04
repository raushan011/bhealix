"use client";

import { useEffect, useRef, useState } from "react";

export type PincodePlace = { pinCode: string; city: string; state: string };

/**
 * Fills the city and state from a pin code as soon as all six digits are in,
 * the way Shiprocket's own order form does.
 *
 * `onFound` runs only for a pin code that was *typed* — the one the form opened
 * with is left alone, so editing an existing order never overwrites a city
 * somebody corrected by hand. Returns whether a lookup is in flight and whether
 * the last one found nothing, for a hint under the field.
 */
export function usePincodeLookup(pinCode: string, onFound: (place: PincodePlace) => void) {
  const [looking, setLooking] = useState(false);
  const [missing, setMissing] = useState(false);
  const handled = useRef(pinCode);
  const found = useRef(onFound);
  found.current = onFound;

  useEffect(() => {
    if (!/^\d{6}$/.test(pinCode)) { setMissing(false); if (!pinCode) handled.current = ""; return; }
    if (handled.current === pinCode) return;
    handled.current = pinCode;

    const controller = new AbortController();
    setLooking(true); setMissing(false);
    fetch(`/api/pincode/${pinCode}`, { signal: controller.signal })
      .then(async response => {
        const json = await response.json().catch(() => ({})) as { data?: PincodePlace };
        if (response.ok && json.data) found.current(json.data); else setMissing(true);
      })
      .catch(() => { /* aborted or offline: the fields stay as typed */ })
      .finally(() => { if (!controller.signal.aborted) setLooking(false); });
    return () => controller.abort();
  }, [pinCode]);

  return { looking, missing };
}
