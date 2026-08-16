import Link from "next/link";
import { Loader2 } from "lucide-react";
import { buttonBase, buttonTone, type ButtonTone } from "./button-style";

/*
 * Re-exported rather than defined here so every existing call site keeps
 * importing it from the kit. It lives in its own module because it needs
 * `"use client"` to watch its handler, and seventeen server components import
 * this file for `Badge`, `Card` and `Stat` — marking the whole kit would drag
 * all of them across the boundary for one component's sake.
 */
export { Button } from "./button";

export function LinkButton({ tone = "primary", href, className = "", children }:
  { tone?: ButtonTone; href: string; className?: string; children: React.ReactNode }) {
  return <Link href={href} className={`${buttonBase} ${buttonTone[tone]} ${className}`}>{children}</Link>;
}

export function Card({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return <section className={`card ${className}`}>{children}</section>;
}

export function PageTitle({ title, subtitle, actions }:
  { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
    <div className="min-w-0">
      <h1 className="wrap-break-word text-[22px] sm:text-2xl">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-[var(--muted)]">{subtitle}</p>}
    </div>
    {/*
     * `max-w-full` rather than `shrink-0`: a title bar with three buttons is
     * wider than a phone, and refusing to shrink pushed the whole page sideways
     * instead of wrapping the row it was given.
     */}
    {actions && <div className="flex max-w-full flex-wrap gap-2 sm:justify-end">{actions}</div>}
  </header>;
}

type BadgeTone = "neutral" | "brand" | "success" | "warn" | "danger" | "info";

/**
 * Every tone carries its own outline as well as its fill.
 *
 * A fill alone is enough to tell a status apart when the fills are different
 * hues, and not enough when they are steps on one grey ladder — which is what
 * the monochrome palette makes them. The border is what gives a chip an edge
 * against the card behind it whatever palette is on, so "Contacted" is a chip
 * rather than a run of loose text.
 */
const badgeTone: Record<BadgeTone, string> = {
  neutral: "bg-[var(--brand-soft)] text-[var(--ink-2)] border-[var(--line-2)]",
  brand: "bg-[var(--brand)] text-[var(--on-brand)] border-[var(--brand)]",
  success: "bg-[var(--ok-bg)] text-[var(--ok-ink)] border-[var(--ok-line)]",
  warn: "bg-[var(--warn-bg)] text-[var(--warn-ink)] border-[var(--warn-line)]",
  danger: "bg-[var(--danger-bg)] text-[var(--danger-ink)] border-[var(--danger-line)]",
  info: "bg-[var(--info-bg)] text-[var(--info-ink)] border-[var(--info-line)]"
};
export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: React.ReactNode }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${badgeTone[tone]}`}>{children}</span>;
}

/** Maps domain values to a consistent colour so a status means the same thing everywhere. */
export function statusTone(value?: string): BadgeTone {
  switch (value) {
    case "Completed": case "Active": case "High": return "success";
    case "In progress": case "Assigned": return "info";
    case "Planned": case "Draft": case "Medium": return "neutral";
    case "Hot": case "Missed": case "Cancelled": return "danger";
    case "Rescheduled": case "Low": return "warn";
    default: return "neutral";
  }
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="block">
    <span className="mb-1.5 block text-[13px] font-medium text-[var(--ink-2)]">{label}</span>
    {children}
    {hint && <span className="mt-1 block text-xs text-[var(--muted)]">{hint}</span>}
  </label>;
}

/**
 * One figure with its name above it.
 *
 * The value steps down a size on phones and is allowed to break: these tiles
 * sit two or three to a row, and a rupee total runs to twelve characters, which
 * at the desktop size is wider than the column it was given. Breaking a long
 * figure onto a second line is ugly; pushing the card off the side of the screen
 * is worse. The label truncates instead — it is the part that can be guessed.
 */
export function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return <div className="min-w-0">
    <p className="truncate text-xs text-[var(--muted)]">{label}</p>
    <p className={`mt-0.5 wrap-break-word text-lg font-semibold leading-tight tabular-nums sm:text-xl ${tone ?? ""}`}>{value}</p>
  </div>;
}

export function Notice({ tone = "info", children }: { tone?: "info" | "success" | "warning" | "error"; children: React.ReactNode }) {
  const styles = {
    info: "border-[var(--line)] bg-[var(--surface)] text-[var(--ink-2)]",
    success: "border-[var(--ok-line)] bg-[var(--ok-bg)] text-[var(--ok-ink)]",
    // For something that did work but not as well as it should have — a photo
    // saved with no location. An error tone would read as "nothing was saved".
    warning: "border-[var(--warn-line)] bg-[var(--warn-bg)] text-[var(--warn-ink)]",
    error: "border-[var(--danger-line)] bg-[var(--danger-bg)] text-[var(--danger-ink)]"
  }[tone];
  return <p role="status" className={`wrap-break-word rounded-[10px] border px-4 py-3 text-sm font-medium ${styles}`}>{children}</p>;
}

export function EmptyState({ icon: Icon, title, description, action }:
  { icon: React.ComponentType<{ size?: number; className?: string }>; title: string; description?: string; action?: React.ReactNode }) {
  return <div className="card px-6 py-12 text-center">
    <Icon size={26} className="mx-auto text-[var(--line-2)]" />
    <h3 className="mt-3 text-[15px] font-semibold">{title}</h3>
    {description && <p className="mx-auto mt-1 max-w-sm text-sm text-[var(--muted)]">{description}</p>}
    {action && <div className="mt-5 flex justify-center">{action}</div>}
  </div>;
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return <div className="py-16 text-center text-sm text-[var(--muted)]">
    <Loader2 size={24} className="mx-auto animate-spin text-[var(--line-2)]" />
    <p className="mt-2">{label}</p>
  </div>;
}
