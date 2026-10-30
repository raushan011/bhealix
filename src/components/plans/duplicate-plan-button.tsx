"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Copy, Loader2, X } from "lucide-react";

/**
 * Copies a plan onto extra dates. Each date becomes its own plan with the same
 * doctors, start and timing; the server rebuilds the order for that weekday.
 */
export function DuplicatePlanButton({ planId, planName }: { planId: string; planName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [dates, setDates] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function add() {
    if (!draft) return;
    if (!dates.includes(draft)) setDates([...dates, draft].sort());
    setDraft("");
  }

  async function submit() {
    // Include a date typed but not yet added, so it is never silently dropped.
    const all = draft && !dates.includes(draft) ? [...dates, draft] : dates;
    if (!all.length) { setError("Pick at least one date"); return; }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/plans/${planId}/duplicate`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dates: all })
      });
      const json = await response.json() as { error?: string; data?: { created: string[] } };
      if (!response.ok) throw new Error(json.error ?? "Could not duplicate this plan");
      const created = json.data?.created ?? [];
      setOpen(false);
      setDates([]);
      setDraft("");
      router.push(created.length === 1 ? `/admin/plans/${created[0]}` : "/admin/plans");
      router.refresh();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not duplicate this plan");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <button onClick={() => setOpen(true)}
      className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-[10px] border border-[var(--line-2)] bg-[var(--surface)] px-4 text-sm font-semibold transition-colors hover:bg-[var(--surface-2)]">
      <Copy size={15} />Duplicate
    </button>
    {open && <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md space-y-4 rounded-2xl bg-[var(--surface)] p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Duplicate plan</h2>
            <p className="text-xs text-[var(--muted)]">&ldquo;{planName}&rdquo; is copied to each date you add, with the same doctors and start.</p>
          </div>
          <button onClick={() => setOpen(false)} aria-label="Close" className="grid size-8 place-items-center rounded-lg hover:bg-[var(--surface-2)]"><X size={16} /></button>
        </div>

        <div className="flex gap-2">
          <input type="date" value={draft} onChange={event => setDraft(event.target.value)}
            className="min-h-[44px] flex-1 rounded-[10px] border border-[var(--line-2)] bg-[var(--surface)] px-3 text-sm" />
          <button onClick={add} type="button"
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[10px] border border-[var(--line-2)] px-3 text-sm font-semibold hover:bg-[var(--surface-2)]">
            <CalendarPlus size={15} />Add
          </button>
        </div>

        {dates.length > 0 && <ul className="flex flex-wrap gap-2">
          {dates.map(date => <li key={date} className="inline-flex items-center gap-1.5 rounded-full bg-[var(--brand-soft)] px-3 py-1 text-xs font-semibold text-[var(--brand)]">
            {date}
            <button onClick={() => setDates(dates.filter(item => item !== date))} aria-label={`Remove ${date}`}><X size={12} /></button>
          </li>)}
        </ul>}

        {error && <p className="text-sm text-[var(--danger-ink)]">{error}</p>}

        <div className="flex justify-end gap-2">
          <button onClick={() => setOpen(false)} className="min-h-[44px] rounded-[10px] px-4 text-sm font-semibold hover:bg-[var(--surface-2)]">Cancel</button>
          <button onClick={submit} disabled={busy}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-[10px] bg-[var(--brand)] px-4 text-sm font-semibold text-[var(--on-brand)] disabled:opacity-50">
            {busy && <Loader2 size={15} className="animate-spin" />}Create copies
          </button>
        </div>
      </div>
    </div>}
  </>;
}
