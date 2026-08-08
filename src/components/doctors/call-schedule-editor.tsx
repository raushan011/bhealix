"use client";

import { useState } from "react";
import { Copy, Plus, X } from "lucide-react";
import { Button, Field, Notice } from "@/components/ui/kit";
import { WEEKDAYS, WEEKDAY_SHORT } from "@/lib/time";

export type EditableWindow = {
  weekday: number;
  slots: Array<{ start: string; end: string }>;
  appointmentRequired: boolean;
  remarks: string;
};

const blankWindow = (weekday: number, template?: EditableWindow): EditableWindow => ({
  weekday,
  slots: template ? template.slots.map(slot => ({ ...slot })) : [{ start: "10:00", end: "13:00" }],
  appointmentRequired: template?.appointmentRequired ?? false,
  remarks: template?.remarks ?? ""
});

/**
 * The one place call timings are edited, used by the admin desk and by reps in
 * the field. Reps correct these after speaking to the doctor, which is what
 * keeps route planning honest.
 */
export function CallScheduleEditor({ doctorId, doctorName, initial, onSaved, onCancel }: {
  doctorId: string;
  doctorName: string;
  initial: EditableWindow[];
  onSaved: (windows: EditableWindow[]) => void;
  onCancel?: () => void;
}) {
  const [windows, setWindows] = useState<EditableWindow[]>(
    [...initial].sort((a, b) => a.weekday - b.weekday)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const selected = new Set(windows.map(window => window.weekday));

  function toggleDay(weekday: number) {
    setWindows(current => {
      if (current.some(window => window.weekday === weekday)) {
        return current.filter(window => window.weekday !== weekday);
      }
      return [...current, blankWindow(weekday, current[0])].sort((a, b) => a.weekday - b.weekday);
    });
  }

  function update(weekday: number, patch: Partial<EditableWindow>) {
    setWindows(current => current.map(window => window.weekday === weekday ? { ...window, ...patch } : window));
  }

  function updateSlot(weekday: number, index: number, patch: Partial<{ start: string; end: string }>) {
    setWindows(current => current.map(window => window.weekday === weekday
      ? { ...window, slots: window.slots.map((slot, i) => i === index ? { ...slot, ...patch } : slot) }
      : window));
  }

  function addSlot(weekday: number) {
    setWindows(current => current.map(window => window.weekday === weekday && window.slots.length < 3
      ? { ...window, slots: [...window.slots, { start: "17:00", end: "19:00" }] }
      : window));
  }

  function removeSlot(weekday: number, index: number) {
    setWindows(current => current.map(window => window.weekday === weekday && window.slots.length > 1
      ? { ...window, slots: window.slots.filter((_, i) => i !== index) }
      : window));
  }

  /** Most doctors keep the same hours every day they see reps. */
  function copyFirstToAll() {
    setWindows(current => {
      const [first] = current;
      if (!first) return current;
      return current.map(window => window.weekday === first.weekday ? window : {
        ...window,
        slots: first.slots.map(slot => ({ ...slot })),
        appointmentRequired: first.appointmentRequired
      });
    });
  }

  async function save() {
    setSaving(true); setError("");
    try {
      const response = await fetch(`/api/doctors/${doctorId}/call-schedule`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ callSchedule: windows })
      });
      const json = await response.json() as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "Could not save the call time");
      onSaved(windows);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not save the call time");
      setSaving(false);
    }
  }

  return <div className="space-y-5">
    <div>
      <p className="mb-2 text-[13px] font-medium text-[var(--ink-2)]">Days {doctorName} meets representatives</p>
      <div className="flex flex-wrap gap-1.5">
        {WEEKDAYS.map((day, weekday) => (
          <button key={day} type="button" onClick={() => toggleDay(weekday)} aria-pressed={selected.has(weekday)}
            className={`min-h-[38px] rounded-[10px] border px-3 text-xs font-semibold transition-colors ${
              selected.has(weekday)
                ? "border-[var(--brand)] bg-[var(--brand)] text-[var(--on-brand)]"
                : "border-[var(--line-2)] bg-[var(--surface)] text-[var(--ink-2)] hover:bg-[var(--surface-2)]"
            }`}>{WEEKDAY_SHORT[weekday]}</button>
        ))}
      </div>
    </div>

    {windows.length > 1 && (
      <button type="button" onClick={copyFirstToAll} className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--brand)]">
        <Copy size={13} />Use {WEEKDAY_SHORT[windows[0].weekday]} timings for every selected day
      </button>
    )}

    {windows.map(window => (
      <div key={window.weekday} className="rounded-[10px] border border-[var(--line)] p-3">
        <p className="text-sm font-semibold">{WEEKDAYS[window.weekday]}</p>

        {window.slots.map((slot, index) => (
          <div key={index} className="mt-2.5 flex items-end gap-2">
            <div className="flex-1"><Field label={index === 0 ? "From" : "Also from"}>
              <input type="time" value={slot.start} onChange={e => updateSlot(window.weekday, index, { start: e.target.value })} className="input" />
            </Field></div>
            <div className="flex-1"><Field label="Until">
              <input type="time" value={slot.end} onChange={e => updateSlot(window.weekday, index, { end: e.target.value })} className="input" />
            </Field></div>
            {window.slots.length > 1 && (
              <button type="button" onClick={() => removeSlot(window.weekday, index)} aria-label="Remove this time slot"
                className="tap mb-0.5 grid shrink-0 place-items-center rounded-[10px] text-[var(--muted)] hover:bg-[var(--surface-2)]"><X size={16} /></button>
            )}
          </div>
        ))}

        {window.slots.length < 3 && (
          <button type="button" onClick={() => addSlot(window.weekday)} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand)]">
            <Plus size={13} />Add another slot
          </button>
        )}

        <label className="mt-3 flex items-center gap-2 text-[13px] font-medium">
          <input type="checkbox" checked={window.appointmentRequired}
            onChange={e => update(window.weekday, { appointmentRequired: e.target.checked })}
            className="size-4 accent-[var(--brand)]" />
          Appointment needed
        </label>

        <div className="mt-3">
          <Field label="Remarks">
            <input value={window.remarks} onChange={e => update(window.weekday, { remarks: e.target.value })}
              placeholder="e.g. token system, avoid lunch hour" className="input" />
          </Field>
        </div>
      </div>
    ))}

    {!windows.length && (
      <p className="rounded-[10px] border border-dashed border-[var(--line-2)] px-4 py-6 text-center text-sm text-[var(--muted)]">
        Pick the days this doctor meets representatives.
      </p>
    )}

    {error && <Notice tone="error">{error}</Notice>}

    <div className="flex gap-2">
      <Button onClick={save} busy={saving} className="flex-1">{saving ? "Saving…" : "Save call time"}</Button>
      {onCancel && <Button tone="secondary" onClick={onCancel}>Cancel</Button>}
    </div>
  </div>;
}
