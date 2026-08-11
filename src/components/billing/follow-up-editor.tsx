"use client";

import { CalendarPlus, Check, Trash2, Undo2 } from "lucide-react";
import { formatDate, todayIso } from "@/lib/time";
import { dueDateFrom } from "@/lib/billing/numbering";
import { FOLLOW_UP_LIMIT } from "@/lib/billing/follow-ups";
import type { InvoiceFollowUp } from "@/lib/billing/types";

/**
 * A follow-up as a form holds it: the stored id where there is one, so the server
 * can tell an edited chase from a new one, and `done` as a plain flag — the form
 * has no business inventing the timestamp behind it.
 */
export type FollowUpDraft = { _id?: string; date: string; note: string; done: boolean };

/** The bill's stored follow-ups as the editor holds them. */
export const draftsOf = (list?: InvoiceFollowUp[] | null): FollowUpDraft[] =>
  [...(list ?? [])]
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .map(entry => ({
      _id: entry._id,
      date: entry.date.slice(0, 10),
      note: entry.note ?? "",
      done: Boolean(entry.doneAt)
    }));

/** Only the ones with a date go to the server; a half-typed row is not a chase. */
export const filledFollowUps = (drafts: FollowUpDraft[]) => drafts.filter(draft => draft.date);

/**
 * Editing every chase agreed on a bill.
 *
 * The same editor on the bill form and in the dates dialog, so what "follow up"
 * means does not change depending on which screen somebody opened. Rows can be
 * added, dated, annotated, marked as made and removed; the server keeps the
 * earliest one still outstanding as the bill's `followUpDate`.
 */
export function FollowUpEditor({ value, onChange, hint }: {
  value: FollowUpDraft[];
  onChange: (next: FollowUpDraft[]) => void;
  hint?: string;
}) {
  const set = (index: number, patch: Partial<FollowUpDraft>) =>
    onChange(value.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)));

  /**
   * A new row starts a week after the last chase rather than today: follow-ups
   * are a sequence, and every one of them typed from scratch was how the list
   * ended up with three calls on the same afternoon.
   */
  function add() {
    const last = [...value].map(draft => draft.date).filter(Boolean).sort().pop();
    onChange([...value, { date: dueDateFrom(last || todayIso(), 7), note: "", done: false }]);
  }

  return <div className="space-y-2">
    {value.length === 0 && (
      <p className="rounded-[10px] border border-dashed border-[var(--line-2)] px-3 py-2.5 text-xs text-[var(--muted)]">
        No follow-up scheduled. Add as many as have been agreed — the earliest one still to be made is
        the one that shows on the bill and on the rep&apos;s phone.
      </p>
    )}

    {value.map((draft, index) => (
      <div key={draft._id ?? `new-${index}`}
        className={`rounded-[10px] border border-[var(--line)] p-2.5 ${draft.done ? "bg-[var(--surface-2)]" : ""}`}>
        <div className="flex items-center gap-2">
          <input type="date" value={draft.date} aria-label={`Follow-up ${index + 1} date`}
            onChange={e => set(index, { date: e.target.value })}
            className={`input min-w-0 flex-1 ${draft.done ? "line-through" : ""}`} />
          <button type="button" onClick={() => set(index, { done: !draft.done })}
            aria-label={draft.done ? "Put this follow-up back on the list" : "Mark this follow-up as made"}
            title={draft.done ? "Put this follow-up back on the list" : "Mark this follow-up as made"}
            className={`tap grid shrink-0 place-items-center rounded-[10px] border ${
              draft.done
                ? "border-[var(--ok-line)] bg-[var(--ok-bg)] text-[var(--ok-ink)]"
                : "border-[var(--line-2)] text-[var(--muted)]"
            }`}>
            {draft.done ? <Undo2 size={15} /> : <Check size={15} />}
          </button>
          <button type="button" onClick={() => onChange(value.filter((_, i) => i !== index))}
            aria-label="Remove this follow-up"
            className="tap grid shrink-0 place-items-center rounded-[10px] text-[var(--danger-ink)]">
            <Trash2 size={15} />
          </button>
        </div>
        <input value={draft.note} onChange={e => set(index, { note: e.target.value })}
          aria-label={`Follow-up ${index + 1} note`} maxLength={200}
          placeholder="What was agreed — “balance promised after the 15th”"
          className="input mt-2" />
        {draft.done && draft.date && (
          <p className="mt-1.5 text-xs font-medium text-[var(--ok-ink)]">Called on {formatDate(draft.date)}</p>
        )}
      </div>
    ))}

    <div className="flex flex-wrap items-center justify-between gap-2">
      <button type="button" onClick={add} disabled={value.length >= FOLLOW_UP_LIMIT}
        className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand)] disabled:opacity-50">
        <CalendarPlus size={13} />Add a follow-up
      </button>
      {hint && <span className="text-xs text-[var(--muted)]">{hint}</span>}
    </div>
  </div>;
}
