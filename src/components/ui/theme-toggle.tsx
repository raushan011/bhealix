"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { applyTheme, readTheme, resolveTheme, type Theme } from "@/lib/theme";

/**
 * The light/dark switch.
 *
 * One button rather than a three-way control: the third state — follow the
 * device — is where everybody starts, and the moment somebody reaches for this
 * they have decided the device is wrong. Pressing it commits to the opposite of
 * what is on screen, which is the only thing the press could reasonably mean.
 *
 * The icon shows what pressing it will *give* you, not what you are in: a moon
 * on a light screen. Nothing renders until the first effect has run, because
 * the server cannot know what the device prefers and rendering a sun that flips
 * to a moon on hydration is worse than a beat of empty space.
 */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(readTheme());

    // The device can change under us — a phone at sunset, a laptop on a
    // schedule — and somebody who has never chosen should follow it.
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = () => setTheme(current => (current === "system" ? "system" : current));
    media.addEventListener("change", follow);
    return () => media.removeEventListener("change", follow);
  }, []);

  if (theme === null) return <span className={`tap block ${className}`} aria-hidden />;

  const showing = resolveTheme(theme);
  const next = showing === "dark" ? "light" : "dark";

  return <button type="button" aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`}
    onClick={() => { applyTheme(next); setTheme(next); }}
    className={`tap grid shrink-0 place-items-center rounded-[10px] text-[var(--muted)] hover:bg-[var(--surface-2)] ${className}`}>
    {showing === "dark" ? <Sun size={17} /> : <Moon size={17} />}
  </button>;
}
