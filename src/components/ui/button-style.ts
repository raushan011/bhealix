/**
 * What a button looks like, kept apart from what it does.
 *
 * `Button` has to be a client component — it watches its own handler to know
 * when it is working — while `LinkButton` next door is a plain anchor that
 * server components render directly. A `"use client"` module's exports are
 * client references, so these strings would not survive being imported into a
 * server component; a third module with no directive is what lets both wear the
 * same clothes.
 */

export type ButtonTone = "primary" | "secondary" | "ghost" | "danger";

export const buttonTone: Record<ButtonTone, string> = {
  primary: "bg-[var(--brand)] text-[var(--on-brand)] hover:bg-[var(--brand-hover)] disabled:opacity-50",
  secondary: "bg-[var(--surface)] text-[var(--ink)] border border-[var(--line-2)] hover:bg-[var(--surface-2)] disabled:opacity-50",
  ghost: "text-[var(--ink-2)] hover:bg-[var(--surface-2)] disabled:opacity-50",
  danger: "bg-[var(--surface)] text-[var(--danger-ink)] border border-[var(--danger-line)] hover:bg-[var(--danger-bg)] disabled:opacity-50"
};

export const buttonBase = "inline-flex items-center justify-center gap-2 rounded-[10px] px-4 min-h-[44px] text-sm font-semibold transition-colors disabled:cursor-not-allowed";
