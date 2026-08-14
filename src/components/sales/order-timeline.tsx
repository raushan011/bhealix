import { Check, Circle, Dot, X } from "lucide-react";
import { formatDate } from "@/lib/time";
import type { TrackStep } from "@/lib/sales/tracking";

/**
 * One order's journey, drawn as a rail.
 *
 * A vertical rail rather than a horizontal stepper because the audience is on a
 * phone: six steps across a 360px screen leaves room for icons and nothing else,
 * and the detail lines — the courier, the date the commission clears — are the
 * half worth reading.
 *
 * The rail behind a finished step is coloured and the rail after it is not, so
 * where the order has got to is legible at a glance without reading a word. The
 * icon carries the same information in shape as well as in colour, because a
 * green tick and a grey circle are the same circle to a red-green colourblind
 * reader.
 */

const LOOK = {
  done: {
    icon: Check,
    dot: "bg-[var(--ok-bg)] text-[var(--ok-ink)]",
    label: "text-[var(--ink)]"
  },
  current: {
    icon: Dot,
    dot: "bg-[var(--brand)] text-[var(--on-brand)]",
    label: "text-[var(--ink)] font-semibold"
  },
  waiting: {
    icon: Circle,
    dot: "bg-[var(--surface-2)] text-[var(--muted)]",
    label: "text-[var(--muted)]"
  },
  failed: {
    icon: X,
    dot: "bg-[var(--danger-bg)] text-[var(--danger-ink)]",
    label: "text-[var(--muted)]"
  }
} as const;

export function OrderTimeline({ steps }: { steps: TrackStep[] }) {
  return <ol className="relative">
    {steps.map((step, at) => {
      const look = LOOK[step.state];
      const Icon = look.icon;
      const last = at === steps.length - 1;
      // The rail belongs to the step above it: it is coloured when that step is
      // behind us, which is what makes the filled length mean "how far along".
      const railLit = step.state === "done";

      return <li key={step.key} className="relative flex gap-3 pb-5 last:pb-0">
        {!last && (
          <span aria-hidden
            className={`absolute left-[13px] top-7 h-[calc(100%-1.75rem)] w-0.5 rounded ${railLit ? "bg-[var(--ok-line)]" : "bg-[var(--line)]"}`} />
        )}

        <span className={`relative z-10 grid size-7 shrink-0 place-items-center rounded-full ${look.dot}`}>
          <Icon size={step.state === "current" ? 22 : 15} strokeWidth={step.state === "waiting" ? 2 : 3} />
        </span>

        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <p className={`text-sm ${look.label}`}>{step.label}</p>
            {step.at && <p className="text-xs tabular-nums text-[var(--muted)]">{formatDate(step.at)}</p>}
          </div>
          {step.detail && <p className="mt-0.5 wrap-break-word text-xs text-[var(--muted)]">{step.detail}</p>}
        </div>
      </li>;
    })}
  </ol>;
}
