"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Clock, Loader2, MapPin, Search } from "lucide-react";
import { WEEKDAY_SHORT, toDisplayTime } from "@/lib/time";
import type { EditableWindow } from "./call-schedule-editor";

export type PickableDoctor = {
  _id: string; name: string; clinicName?: string; area?: string; city?: string;
  phones?: string[]; location?: { coordinates?: number[] }; callSchedule?: EditableWindow[];
};

export const hasCoordinates = (doctor: PickableDoctor) => (doctor.location?.coordinates?.length ?? 0) === 2;
export const placeOf = (doctor: PickableDoctor) =>
  [doctor.clinicName, doctor.area, doctor.city].filter(Boolean).join(" · ") || "Location not recorded";

/** The doctor's call window on a given weekday, or null when they do not see reps that day. */
export function callTimeOn(doctor: PickableDoctor, weekday: number): string | null {
  const window = doctor.callSchedule?.find(entry => entry.weekday === weekday);
  if (!window?.slots.length) return null;
  return window.slots.map(slot => `${toDisplayTime(slot.start)}–${toDisplayTime(slot.end)}`).join(", ");
}

/**
 * Type-ahead doctor search. When a weekday is supplied it shows each doctor's
 * call window for that day, so the planner can see availability before adding
 * somebody to a route rather than after calculating it.
 */
export function DoctorPicker({ weekday, excludeIds, onSelect, placeholder = "Search doctor, clinic, area or city" }: {
  weekday?: number;
  excludeIds?: Set<string>;
  onSelect: (doctor: PickableDoctor) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<PickableDoctor[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) { setItems([]); setLoading(false); setOpen(false); return; }
    setLoading(true);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/doctors?q=${encodeURIComponent(term)}&routable=1&limit=8`, { signal: controller.signal });
        const json = await response.json() as { data?: { items: PickableDoctor[] } };
        setItems(json.data?.items ?? []); setActive(0); setOpen(true); setLoading(false);
      } catch (error) { if ((error as Error).name !== "AbortError") setLoading(false); }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) { if (!boxRef.current?.contains(event.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  const visible = items.filter(item => !excludeIds?.has(item._id));

  function choose(doctor: PickableDoctor) {
    if (!hasCoordinates(doctor)) return;
    onSelect(doctor); setQuery(""); setItems([]); setOpen(false);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || !visible.length) return;
    if (event.key === "ArrowDown") { event.preventDefault(); setActive(i => (i + 1) % visible.length); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive(i => (i - 1 + visible.length) % visible.length); }
    else if (event.key === "Enter") { event.preventDefault(); choose(visible[active]); }
    else if (event.key === "Escape") setOpen(false);
  }

  return <div ref={boxRef} className="relative">
    <Search size={16} className="pointer-events-none absolute left-3 top-3.5 text-[var(--muted)]" />
    <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={onKeyDown}
      onFocus={() => { if (visible.length) setOpen(true); }}
      placeholder={placeholder} role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
      className="input pl-9 pr-9" />
    {loading && <Loader2 size={15} className="absolute right-3 top-3.5 animate-spin text-[var(--muted)]" />}

    {open && (
      <ul id={listId} role="listbox" className="absolute z-30 mt-1.5 max-h-80 w-full overflow-y-auto rounded-[10px] border border-[var(--line)] bg-white py-1 shadow-lg">
        {visible.length ? visible.map((doctor, index) => {
          const callTime = weekday !== undefined ? callTimeOn(doctor, weekday) : null;
          const unavailable = weekday !== undefined && !callTime;
          return <li key={doctor._id} role="option" aria-selected={index === active}>
            <button type="button" onMouseEnter={() => setActive(index)} onClick={() => choose(doctor)}
              className={`flex w-full items-start gap-2.5 px-3 py-2.5 text-left ${index === active ? "bg-[var(--surface-2)]" : ""}`}>
              <MapPin size={14} className="mt-0.5 shrink-0 text-[var(--brand)]" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{doctor.name}</span>
                <span className="block truncate text-xs text-[var(--muted)]">{placeOf(doctor)}</span>
                {weekday !== undefined && (
                  <span className={`mt-0.5 flex items-center gap-1 text-xs font-medium ${unavailable ? "text-amber-700" : "text-[var(--brand)]"}`}>
                    <Clock size={11} />
                    {callTime ?? `No call time on ${WEEKDAY_SHORT[weekday]}`}
                  </span>
                )}
              </span>
            </button>
          </li>;
        }) : <li className="px-4 py-3 text-sm text-[var(--muted)]">{loading ? "Searching…" : "No doctors found with a saved location"}</li>}
      </ul>
    )}
  </div>;
}
