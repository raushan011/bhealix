"use client";

import { useState } from "react";
import { Check, Loader2, StickyNote } from "lucide-react";

/** Editable note on one clinic of a route; saved on its own, not with the plan. */
export function StopRemarks({ planId, doctorId, initial }: { planId: string; doctorId: string; initial?: string }) {
  const [value, setValue] = useState(initial ?? "");
  const [saved, setSaved] = useState(initial ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/plans/${planId}/remarks`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctorId, remarks: value })
      });
      const json = await response.json() as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "Could not save the remark");
      setSaved(value.trim());
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not save the remark");
    } finally {
      setBusy(false);
    }
  }

  const dirty = value.trim() !== saved;
  return <div className="mt-2">
    <label className="flex items-center gap-1 text-[11px] font-semibold text-[var(--muted)]"><StickyNote size={11} />Remarks</label>
    <div className="mt-1 flex gap-2">
      <textarea value={value} onChange={event => setValue(event.target.value)} rows={2} maxLength={500}
        placeholder="e.g. call before going, ask for the receptionist"
        className="min-h-[44px] flex-1 rounded-[10px] border border-[var(--line-2)] bg-[var(--surface)] px-3 py-2 text-sm" />
      <button onClick={save} disabled={busy || !dirty} aria-label="Save remark"
        className="grid w-11 shrink-0 place-items-center rounded-[10px] bg-[var(--brand)] text-[var(--on-brand)] disabled:opacity-40">
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={16} />}
      </button>
    </div>
    {error && <p className="mt-1 text-xs text-[var(--danger-ink)]">{error}</p>}
  </div>;
}
