"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { buttonBase, buttonTone, type ButtonTone } from "./button-style";

/**
 * A button that knows when it is working.
 *
 * Every mutating button in this application has the same failure available to
 * it: somebody presses Save, nothing visibly happens for the second the round
 * trip takes, and they press it again. On a form that is a duplicate record; on
 * a payout run it is money moved twice. The fix has always been to thread a
 * `busy` flag from the screen's own state, and the trouble with that fix is
 * that it has to be remembered at every one of the several dozen call sites,
 * including the ones not written yet.
 *
 * So the button watches its own handler instead. An `onClick` that returns a
 * promise — which is exactly what an `async` function does — puts the button
 * into its working state until that promise settles, whether it resolves or
 * throws. Nothing at the call site changes, and a handler that was already
 * given an explicit `busy` keeps it: the two are OR-ed, so a screen that
 * disables a whole form while saving still wins.
 *
 * A synchronous handler is left completely alone. Opening a dialog or stepping
 * a page number returns undefined, takes no time, and must not flicker.
 */
export function Button({ tone = "primary", busy, className = "", children, onClick, ...rest }:
  React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: ButtonTone; busy?: boolean }) {
  const [working, setWorking] = useState(false);

  /*
   * A handler that finishes by closing the dialog it lives in unmounts this
   * button, and settling afterwards would set state on something gone. React 18
   * makes that harmless rather than a warning, but the flag is cheap and it
   * keeps the intent legible: only a button still on screen has a state to
   * return to.
   */
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const press = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    const result = onClick?.(event) as unknown;
    if (!(result instanceof Promise)) return;

    setWorking(true);
    // `finally` rather than `then`: a handler that throws has still stopped
    // working, and a button left spinning after a failure looks like a hang
    // even though the error notice is already on screen underneath it.
    result.finally(() => { if (alive.current) setWorking(false); });
  }, [onClick]);

  const showBusy = busy || working;

  return <button {...rest} onClick={press} disabled={rest.disabled || showBusy}
    aria-busy={showBusy || undefined}
    className={`${buttonBase} ${buttonTone[tone]} ${className}`}>
    {showBusy && <Loader2 size={16} className="animate-spin" />}{children}
  </button>;
}
