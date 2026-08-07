import Link from "next/link";
import { Loader2 } from "lucide-react";

type ButtonTone = "primary" | "secondary" | "ghost" | "danger";
const buttonTone: Record<ButtonTone, string> = {
  primary: "bg-[var(--brand)] text-white hover:bg-[var(--brand-hover)] disabled:opacity-50",
  secondary: "bg-white text-[var(--ink)] border border-[var(--line-2)] hover:bg-[var(--surface-2)] disabled:opacity-50",
  ghost: "text-[var(--ink-2)] hover:bg-[var(--surface-2)] disabled:opacity-50",
  danger: "bg-white text-rose-600 border border-rose-200 hover:bg-rose-50 disabled:opacity-50"
};
const buttonBase = "inline-flex items-center justify-center gap-2 rounded-[10px] px-4 min-h-[44px] text-sm font-semibold transition-colors disabled:cursor-not-allowed";

export function Button({ tone = "primary", busy, className = "", children, ...rest }:
  React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: ButtonTone; busy?: boolean }) {
  return <button {...rest} disabled={rest.disabled || busy} className={`${buttonBase} ${buttonTone[tone]} ${className}`}>
    {busy && <Loader2 size={16} className="animate-spin" />}{children}
  </button>;
}

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
const badgeTone: Record<BadgeTone, string> = {
  neutral: "bg-[var(--brand-soft)] text-[var(--ink-2)]",
  brand: "bg-[var(--brand)] text-white",
  success: "bg-emerald-50 text-emerald-800",
  warn: "bg-amber-100 text-amber-900",
  danger: "bg-rose-50 text-rose-700",
  info: "bg-sky-50 text-sky-800"
};
export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: React.ReactNode }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${badgeTone[tone]}`}>{children}</span>;
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

export function Notice({ tone = "info", children }: { tone?: "info" | "success" | "error"; children: React.ReactNode }) {
  const styles = {
    info: "border-[var(--line)] bg-white text-[var(--ink-2)]",
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
    error: "border-rose-200 bg-rose-50 text-rose-800"
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
