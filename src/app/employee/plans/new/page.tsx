"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Clock, ExternalLink, MapPin, Navigation, Route, Save, Trash2, TriangleAlert
} from "lucide-react";
import { Button, Card, Field, Notice, PageTitle, Stat } from "@/components/ui/kit";
import { DoctorPicker, placeOf, type PickableDoctor } from "@/components/doctors/doctor-picker";
import { StartingPointPicker, type PlanOriginValue } from "@/components/plans/starting-point-picker";
import { callTimeOn } from "@/lib/doctors/call-schedule";
import { directionsUrl, routeUrl } from "@/lib/maps";
import { WEEKDAYS, formatDuration, todayIso, toDisplayTime, weekdayOf } from "@/lib/time";

/** The request body's shape for where the day starts, from a picked origin. */
function originPayload(origin: PlanOriginValue) {
  return origin.kind === "doctor"
    ? { kind: "doctor" as const, doctorId: origin.doctor._id }
    : { kind: origin.kind, label: origin.label, latitude: origin.latitude, longitude: origin.longitude };
}
/** `routeUrl`/`directionsUrl` speak GeoJSON — [longitude, latitude]. */
function originLocated(origin: PlanOriginValue | null) {
  return origin && origin.kind !== "doctor" ? { location: { coordinates: [origin.longitude, origin.latitude] } } : null;
}

type Stop = {
  sequence: number; doctor: PickableDoctor; distanceFromPreviousKm: number;
  travelMinutes: number; waitMinutes: number; plannedStart: string; plannedEnd: string;
  withinCallTime: boolean; timingUnknown: boolean;
};
type Preview = {
  stops: Stop[]; totalDistanceKm: number; totalTravelMinutes: number;
  finishTime: string; outsideCallTimeCount: number; unknownTimingCount: number;
};

/**
 * The rep planning their own day, on a phone.
 *
 * The same ordering engine the office uses — call time first, distance second —
 * but stripped to what somebody standing outside a clinic can actually work
 * with: no assignment, no spreadsheet upload, and the route saved straight to
 * their own day.
 */
export default function PlanMyRoute() {
  const router = useRouter();
  const [date, setDate] = useState(todayIso());
  const [startTime, setStartTime] = useState("09:30");
  const [visitMinutes, setVisitMinutes] = useState(45);
  const [origin, setOrigin] = useState<PlanOriginValue | null>(null);
  const [selected, setSelected] = useState<PickableDoctor[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const weekday = weekdayOf(date);
  const excludeIds = new Set([origin?.kind === "doctor" ? origin.doctor._id : undefined, ...selected.map(d => d._id)].filter((id): id is string => Boolean(id)));
  // Any change invalidates the route already built, so it is cleared rather
  // than left on screen describing a plan that no longer matches the inputs.
  const reset = () => { setPreview(null); setError(""); };

  async function calculate() {
    if (!origin || !selected.length) return;
    setCalculating(true); setError(""); setPreview(null);
    try {
      const response = await fetch("/api/plans/preview", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          date, origin: originPayload(origin),
          doctorIds: origin.kind === "doctor" ? [origin.doctor._id, ...selected.map(d => d._id)] : selected.map(d => d._id),
          startTime, visitMinutes
        })
      });
      const json = await response.json() as { error?: string; data?: Preview };
      if (!response.ok) throw new Error(json.error ?? "Could not build the route");
      setPreview(json.data ?? null);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not build the route");
    } finally { setCalculating(false); }
  }

  async function save() {
    if (!preview || !origin) return;
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/plans", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: `${WEEKDAYS[weekday]} round – ${date}`,
          date, origin: originPayload(origin),
          doctorIds: origin.kind === "doctor" ? [origin.doctor._id, ...selected.map(d => d._id)] : selected.map(d => d._id),
          startTime, visitMinutes
          // No assignedTo: the server puts the plan in the name of whoever built it.
        })
      });
      const json = await response.json() as { error?: string; data?: { _id: string } };
      if (!response.ok) throw new Error(json.error ?? "Could not save the plan");
      router.push(`/employee/plans/${json.data?._id}`);
      router.refresh();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not save the plan");
      setSaving(false);
    }
  }

  const startPoint = originLocated(origin);
  const link = preview ? routeUrl(startPoint ? [startPoint, ...preview.stops.map(stop => stop.doctor)] : preview.stops.map(stop => stop.doctor)) : null;

  return <div className="space-y-4 pb-6">
    <Link href="/employee/plans" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--brand)]">
      <ArrowLeft size={15} />Back to plans
    </Link>
    <PageTitle title="Plan my round" subtitle="Doctors are ordered by their call time first, then by how far apart they are" />

    <Card className="space-y-4 p-4">
      <Field label="Day" hint={WEEKDAYS[weekday]}>
        <input type="date" value={date} onChange={e => { setDate(e.target.value); reset(); }} className="input" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Start at">
          <input type="time" value={startTime} onChange={e => { setStartTime(e.target.value); reset(); }} className="input" />
        </Field>
        <Field label="Minutes each">
          <input type="number" min={10} max={180} value={visitMinutes} className="input"
            onChange={e => { setVisitMinutes(Number(e.target.value) || 45); reset(); }} />
        </Field>
      </div>
    </Card>

    <Card className="space-y-3 p-4">
      <div>
        <h2 className="text-[15px] font-semibold">Where you start</h2>
        <p className="mt-0.5 text-sm text-[var(--muted)]">A doctor, home, your current location, or any other place.</p>
      </div>
      <StartingPointPicker weekday={weekday} excludeDoctorIds={excludeIds}
        value={origin} onChange={value => { setOrigin(value); reset(); }} />
    </Card>

    <Card className={`space-y-3 p-4 ${origin ? "" : "pointer-events-none opacity-50"}`}>
      <div>
        <h2 className="text-[15px] font-semibold">Who else you are seeing</h2>
        <p className="mt-0.5 text-sm text-[var(--muted)]">Add them in any order — the round is worked out for you.</p>
      </div>

      <DoctorPicker weekday={weekday} excludeIds={excludeIds}
        onSelect={doctor => { reset(); setSelected(current => [...current, doctor]); }}
        placeholder="Add a doctor" />

      {selected.length ? (
        <ul className="divide-y divide-[var(--line)] rounded-[10px] border border-[var(--line)]">
          {selected.map(doctor => {
            const callTime = callTimeOn(doctor, weekday);
            return <li key={doctor._id} className="flex items-center gap-3 px-3 py-2.5">
              <MapPin size={14} className="shrink-0 text-[var(--brand)]" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{doctor.name}</p>
                <p className={`flex items-center gap-1 truncate text-xs ${callTime ? "text-[var(--muted)]" : "text-[var(--warn-ink)]"}`}>
                  <Clock size={11} />{callTime ?? `No call time on ${WEEKDAYS[weekday]}`}
                </p>
              </div>
              <button onClick={() => { reset(); setSelected(current => current.filter(d => d._id !== doctor._id)); }}
                aria-label={`Remove ${doctor.name}`}
                className="tap grid shrink-0 place-items-center rounded-[10px] text-[var(--danger-ink)]"><Trash2 size={14} /></button>
            </li>;
          })}
        </ul>
      ) : (
        <p className="rounded-[10px] border border-dashed border-[var(--line-2)] px-4 py-6 text-center text-sm text-[var(--muted)]">
          Nobody added yet
        </p>
      )}

      <Button onClick={calculate} busy={calculating} disabled={!selected.length} className="w-full">
        <Route size={16} />{preview ? "Rebuild the round" : "Build the round"}
      </Button>
    </Card>

    {error && <Notice tone="error">{error}</Notice>}

    {preview && <Card className="space-y-4 p-4">
      <div className="grid grid-cols-2 gap-4 rounded-[10px] border border-[var(--line)] bg-[var(--surface-2)] p-4">
        <Stat label="Stops" value={preview.stops.length} />
        <Stat label="Distance" value={`${preview.totalDistanceKm} km`} />
        <Stat label="Travelling" value={formatDuration(preview.totalTravelMinutes)} />
        <Stat label="Finishes" value={toDisplayTime(preview.finishTime)} />
      </div>

      {preview.outsideCallTimeCount > 0 && (
        <div className="flex items-start gap-2.5 rounded-[10px] border border-[var(--warn-line)] bg-[var(--warn-bg)] p-3 text-sm text-[var(--warn-ink)]">
          <TriangleAlert size={16} className="mt-0.5 shrink-0" />
          <p><strong>{preview.outsideCallTimeCount}</strong> cannot be reached inside their call window. Start earlier,
            give each doctor less time, or leave them for another day.</p>
        </div>
      )}

      <ol className="space-y-2">
        {startPoint && origin && origin.kind !== "doctor" && (
          <li className="flex items-center gap-3 rounded-[10px] border border-[var(--line)] bg-[var(--surface-2)] p-3">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--ink-2)] text-[11px] font-bold text-[var(--on-brand)]">•</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{origin.label}</p>
              <p className="truncate text-xs text-[var(--muted)]">Starting point — not a visit</p>
            </div>
            <p className="shrink-0 text-xs font-bold text-[var(--brand)]">{toDisplayTime(startTime)}</p>
          </li>
        )}
        {preview.stops.map(stop => (
          <li key={stop.doctor._id}
            className={`flex items-center gap-3 rounded-[10px] border p-3 ${stop.withinCallTime ? "border-[var(--line)]" : "border-[var(--warn-line)] bg-[var(--warn-bg)]"}`}>
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--brand)] text-[11px] font-bold text-[var(--on-brand)]">{stop.sequence}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{stop.doctor.name}</p>
              <p className="truncate text-xs text-[var(--muted)]">{placeOf(stop.doctor)}</p>
              {!stop.withinCallTime && <p className="text-xs font-medium text-[var(--warn-ink)]">Outside their call window</p>}
              {stop.waitMinutes > 0 && <p className="text-xs text-[var(--muted)]">Wait {formatDuration(stop.waitMinutes)}</p>}
            </div>
            <div className="shrink-0 text-right">
              <p className="text-xs font-bold text-[var(--brand)]">{toDisplayTime(stop.plannedStart)}</p>
              <p className="text-[11px] text-[var(--muted)]">{stop.distanceFromPreviousKm > 0 ? `${stop.distanceFromPreviousKm} km` : "start"}</p>
            </div>
            {directionsUrl(stop.doctor) && (
              <a href={directionsUrl(stop.doctor)!} target="_blank" rel="noreferrer" aria-label={`Directions to ${stop.doctor.name}`}
                className="tap grid shrink-0 place-items-center rounded-[10px] text-[var(--brand)]"><Navigation size={15} /></a>
            )}
          </li>
        ))}
      </ol>

      {link && <a href={link} target="_blank" rel="noreferrer"
        className="tap flex items-center justify-center gap-2 rounded-[10px] border border-[var(--line-2)] bg-[var(--surface)] text-sm font-semibold">
        <ExternalLink size={15} />Open the whole route in Maps
      </a>}

      <Button onClick={save} busy={saving} className="w-full"><Save size={16} />Save to my day</Button>
      <p className="text-center text-xs text-[var(--muted)]">
        Saving creates your visits for {WEEKDAYS[weekday]}, ready to check in against.
      </p>
    </Card>}
  </div>;
}
