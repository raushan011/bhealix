"use client";

import { useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

/**
 * A password box with a reveal toggle.
 *
 * It lives in its own module rather than in `kit.tsx` on purpose: kit exports
 * plain helpers such as `statusTone` that server pages call directly, and the
 * client directive this component needs would turn every one of those into a
 * client reference.
 *
 * The toggle is a real focusable button, not an icon with a click handler, so
 * somebody working by keyboard can reveal what they typed. `type="button"`
 * matters: inside a form a bare <button> defaults to submit, and tapping the
 * eye would post the login.
 */
export function PasswordInput({ className = "", ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false);
  const describedBy = useId();

  return <span className="relative block">
    <input
      {...rest}
      type={visible ? "text" : "password"}
      aria-describedby={describedBy}
      className={`input pr-12 ${className}`}
    />
    <button
      type="button"
      onClick={() => setVisible(shown => !shown)}
      aria-label={visible ? "Hide password" : "Show password"}
      aria-pressed={visible}
      className="absolute right-1.5 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-[8px] text-[var(--muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink-2)]"
    >
      {visible ? <EyeOff size={17} /> : <Eye size={17} />}
    </button>
    <span id={describedBy} className="sr-only">{visible ? "Password is visible" : "Password is hidden"}</span>
  </span>;
}
