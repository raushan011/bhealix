"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, CalendarDays, Check, Clock, ExternalLink, MapPin, Navigation, Route, Save, TriangleAlert, Trash2, Upload, X } from "lucide-react";
import { Button, Card, Field, Notice, PageTitle, Spinner, Stat } from "@/components/ui/kit";
import { DoctorPicker, placeOf, type PickableDoctor } from "@/components/doctors/doctor-picker";
import { callTimeOn } from "@/lib/doctors/call-schedule";
import { fromExcelRow } from "@/lib/doctors/discovery";
import { directionsUrl, routeUrl } from "@/lib/maps";
import { WEEKDAYS, formatDuration, toDateInput, todayIso, toDisplayTime, weekdayOf } from "@/lib/time";

type Stop = {
  sequence: number; doctor: PickableDoctor; distanceFromPreviousKm: number;
  travelMinutes: number; waitMinutes: number; plannedStart: string; plannedEnd: string;
  withinCallTime: boolean; timingUnknown: boolean;
};
type Preview = {
  stops: Stop[]; totalDistanceKm: number; totalTravelMinutes: number;
  finishTime: string; outsideCallTimeCount: number; unknownTimingCount: number;
};
type FieldStaff = { _id: string; name: string; employeeId: string; role: string };
/** An existing plan being reworked. Stop one is the starting doctor. */
type LoadedPlan = {
  name: string; date: string; startTime?: string; visitMinutes?: number;
  assignedTo?: { _id?: unknown } | null;
  stops: Array<{ sequence: number; doctor?: PickableDoctor }>;
};

function Step({ n, title, hint, done }: { n: number; title: string; hint?: string; done?: boolean }) {
  return <div className="flex items-start gap-2.5">
    <span className={`grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-bold ${done ? "bg-[var(--ok-ink)] text-[var(--on-brand)]" : "bg-[var(--brand)] text-[var(--on-brand)]"}`}>
      {done ? <Check size={13} /> : n}
    </span>
    <div className="min-w-0">
      <h2 className="text-[15px] font-semibold leading-6">{title}</h2>
      {hint && <p className="mt-0.5 text-sm text-[var(--muted)]">{hint}</p>}
    </div>
  </div>;
}

function PlanBuilder() {
  const router = useRouter();
  const editingId = useSearchParams().get("from");
  const [loadingExisting, setLoadingExisting] = useState(Boolean(editingId));
  const [date, setDate] = useState(todayIso());
  const [name, setName] = useState("");
  const [startTime, setStartTime] = useState("09:30");
  const [visitMinutes, setVisitMinutes] = useState(45);
  const [reference, setReference] = useState<PickableDoctor | null>(null);
  const [selected, setSelected] = useState<PickableDoctor[]>([]);
  const [team, setTeam] = useState<FieldStaff[]>([]);
  const [assignedTo, setAssignedTo] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const weekday = weekdayOf(date);

  useEffect(() => {
    fetch("/api/team?field=1").then(r => r.json())
      .then((json: { data?: { items: FieldStaff[] } }) => setTeam(json.data?.items ?? []));
  }, []);

  useEffect(() => { setName(current => current || `${WEEKDAYS[weekday]} route – ${date}`); }, [date, weekday]);

  // Reworking an existing plan: load it back into the builder. The first stop
  // is the starting doctor, so the original route can be reproduced exactly.
  useEffect(() => {
    if (!editingId) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/plans/${editingId}`);
        const json = await response.json() as { error?: string; data?: LoadedPlan };
        if (!response.ok || !json.data) throw new Error(json.error ?? "Could not open that plan");
        if (cancelled) return;

        const plan = json.data;
        const ordered = [...plan.stops].sort((a, b) => a.sequence - b.sequence);
        const doctors = ordered.map(stop => stop.doctor).filter((d): d is PickableDoctor => Boolean(d?._id));

        setName(plan.name);
        setDate(toDateInput(plan.date));
        setStartTime(plan.startTime ?? "09:30");
        setVisitMinutes(plan.visitMinutes ?? 45);
        setAssignedTo(plan.assignedTo?._id ? String(plan.assignedTo._id) : "");
        setReference(doctors[0] ?? null);
        setSelected(doctors.slice(1));
      } catch (problem) {
        if (!cancelled) setError(problem instanceof Error ? problem.message : "Could not open that plan");
      } finally {
        if (!cancelled) setLoadingExisting(false);
      }
    })();
    return () => { cancelled = true; };
  }, [editingId]);

  const excludeIds = new Set([reference?._id, ...selected.map(d => d._id)].filter((id): id is string => Boolean(id)));
  const reset = () => { setPreview(null); setError(""); };

  function addDoctor(doctor: PickableDoctor) { reset(); setSelected(current => [...current, doctor]); }
  function removeDoctor(id: string) { reset(); setSelected(current => current.filter(d => d._id !== id)); }

  async function uploadSheet(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    reset(); setMessage("");
    try {
      const XLSX = await import("xlsx");
      const book = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets[book.SheetNames[0]], { defval: "" });
      const parsed = sheet.map(fromExcelRow).filter((row): row is NonNullable<typeof row> => row !== null);
      if (!parsed.length) { setError("No usable rows in that sheet."); return; }

      const response = await fetch("/api/doctors/bulk", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ doctors: parsed })
      });
      const json = await response.json() as { error?: string; data?: { savedIds: string[] } };
      if (!response.ok) throw new Error(json.error ?? "Could not import that sheet");

      const ids = (json.data?.savedIds ?? []).filter(id => !excludeIds.has(id));
      if (!ids.length) { setMessage("Every doctor in that sheet is already in this plan."); return; }

      const detail = await fetch(`/api/doctors?limit=100&routable=1&q=`).then(r => r.json()) as { data?: { items: PickableDoctor[] } };
      const byId = new Map((detail.data?.items ?? []).map(d => [d._id, d]));
      const resolved = ids.map(id => byId.get(id)).filter((d): d is PickableDoctor => Boolean(d));

      setSelected(current => [...current, ...resolved]);
      const skipped = ids.length - resolved.length;
      setMessage(`${resolved.length} doctor(s) added from the sheet.${skipped ? ` ${skipped} skipped — no latitude/longitude, so they cannot be routed.` : ""}`);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not read that sheet");
    }
  }

  async function calculate() {
    if (!reference || !selected.length) return;
    setCalculating(true); setError(""); setPreview(null);
    try {
      const response = await fetch("/api/plans/preview", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          date, referenceDoctorId: reference._id,
          doctorIds: [reference._id, ...selected.map(d => d._id)],
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
    if (!preview || !reference) return;
    setSaving(true); setError("");
    try {
      // Reworking an existing plan replaces it rather than leaving a duplicate.
      const response = await fetch(editingId ? `/api/plans/${editingId}` : "/api/plans", {
        method: editingId ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name, date, referenceDoctorId: reference._id,
          doctorIds: [reference._id, ...selected.map(d => d._id)],
          startTime, visitMinutes,
          assignedTo: assignedTo || (editingId ? null : undefined)
        })
      });
      const json = await response.json() as { error?: string; data?: { _id: string } };
      if (!response.ok) throw new Error(json.error ?? "Could not save the plan");
      router.push(`/admin/plans/${editingId ?? json.data?._id}`);
      router.refresh();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not save the plan");
      setSaving(false);
    }
  }

  const link = preview ? routeUrl(preview.stops.map(stop => stop.doctor)) : null;

  if (loadingExisting) return <Spinner label="Opening that plan…" />;

  return <div className="space-y-4 pb-10">
    <Link href={editingId ? `/admin/plans/${editingId}` : "/admin/plans"} className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--brand)]">
      <ArrowLeft size={15} />{editingId ? "Back to the plan" : "Back to plans"}
    </Link>
    <PageTitle
      title={editingId ? "Rework this plan" : "Plan a route"}
      subtitle={editingId
        ? "Change the day, doctors or timing and rebuild. Visits already completed are kept."
        : "Visits are ordered by each doctor's call time first, then by travel distance"} />

    <Card className="p-5">
      <Step n={1} title="Day and timing" done={Boolean(date)} />
      <div className="mt-4 grid gap-4 sm:grid-cols-3 sm:pl-8">
        <Field label="Visit date" hint={WEEKDAYS[weekday]}>
          <div className="relative">
            <CalendarDays size={16} className="pointer-events-none absolute left-3 top-3.5 text-[var(--muted)]" />
            <input type="date" value={date} onChange={e => { setDate(e.target.value); reset(); }} className="input pl-9" />
          </div>
        </Field>
        <Field label="Day starts at">
          <input type="time" value={startTime} onChange={e => { setStartTime(e.target.value); reset(); }} className="input" />
        </Field>
        <Field label="Minutes per doctor">
          <input type="number" min={10} max={180} value={visitMinutes}
            onChange={e => { setVisitMinutes(Number(e.target.value) || 45); reset(); }} className="input" />
        </Field>
      </div>
    </Card>

    <Card className="p-5">
      <Step n={2} title="Starting doctor" hint="The day begins here." done={Boolean(reference)} />
      <div className="mt-4 sm:pl-8">
        {reference ? (
          <div className="flex items-center gap-3 rounded-[10px] border border-[var(--brand)] bg-[var(--brand-soft)]/40 p-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--brand)] text-[var(--on-brand)]"><Navigation size={15} /></span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{reference.name}</p>
              <p className="truncate text-xs text-[var(--muted)]">{placeOf(reference)}</p>
              <p className={`mt-0.5 flex items-center gap-1 text-xs font-medium ${callTimeOn(reference, weekday) ? "text-[var(--brand)]" : "text-[var(--warn-ink)]"}`}>
                <Clock size={11} />{callTimeOn(reference, weekday) ?? `No call time on ${WEEKDAYS[weekday]}`}
              </p>
            </div>
            <button onClick={() => { setReference(null); reset(); }} aria-label="Change starting doctor"
              className="tap grid shrink-0 place-items-center rounded-[10px] text-[var(--muted)] hover:bg-[var(--surface)]"><X size={16} /></button>
          </div>
        ) : (
          <DoctorPicker weekday={weekday} excludeIds={excludeIds} onSelect={doctor => { setReference(doctor); reset(); }}
            placeholder="Search the doctor you start the day from" />
        )}
      </div>
    </Card>

    <Card className={`p-5 ${reference ? "" : "pointer-events-none opacity-50"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Step n={3} title="Doctors to visit" hint="Search, or upload a sheet exported from Find doctors." done={selected.length > 0} />
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={uploadSheet} className="hidden" />
        <Button tone="secondary" onClick={() => fileRef.current?.click()} disabled={!reference}><Upload size={15} />Upload sheet</Button>
      </div>

      <div className="mt-4 space-y-3 sm:pl-8">
        <DoctorPicker weekday={weekday} excludeIds={excludeIds} onSelect={addDoctor} placeholder="Add a doctor to this route" />

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
                <button onClick={() => removeDoctor(doctor._id)} aria-label={`Remove ${doctor.name}`}
                  className="tap grid shrink-0 place-items-center rounded-[10px] text-[var(--danger-ink)] hover:bg-[var(--danger-bg)]"><Trash2 size={14} /></button>
              </li>;
            })}
          </ul>
        ) : (
          <p className="rounded-[10px] border border-dashed border-[var(--line-2)] px-4 py-6 text-center text-sm text-[var(--muted)]">
            No doctors added yet
          </p>
        )}

        <Button onClick={calculate} busy={calculating} disabled={!selected.length}>
          <Route size={16} />{preview ? "Rebuild route" : "Build route"}
        </Button>
      </div>
    </Card>

    {message && <Notice>{message}</Notice>}
    {error && <Notice tone="error">{error}</Notice>}

    {preview && <Card className="p-5">
      <Step n={4} title="Route and assignment" />

      <div className="mt-4 space-y-4 sm:pl-8">
        <div className="grid grid-cols-2 gap-4 rounded-[10px] border border-[var(--line)] bg-[var(--surface-2)] p-4 sm:grid-cols-4">
          <Stat label="Stops" value={preview.stops.length} />
          <Stat label="Distance" value={`${preview.totalDistanceKm} km`} />
          <Stat label="On the road" value={formatDuration(preview.totalTravelMinutes)} />
          <Stat label="Finishes" value={toDisplayTime(preview.finishTime)} />
        </div>

        {preview.outsideCallTimeCount > 0 && (
          <div className="flex items-start gap-2.5 rounded-[10px] border border-[var(--warn-line)] bg-[var(--warn-bg)] p-3 text-sm text-[var(--warn-ink)]">
            <TriangleAlert size={16} className="mt-0.5 shrink-0" />
            <p><strong>{preview.outsideCallTimeCount} doctor{preview.outsideCallTimeCount === 1 ? "" : "s"}</strong> cannot be reached inside their call window on this day. Start earlier, shorten visits, or move them to another day.</p>
          </div>
        )}
        {preview.unknownTimingCount > 0 && (
          <div className="flex items-start gap-2.5 rounded-[10px] border border-[var(--line)] bg-[var(--surface)] p-3 text-sm text-[var(--ink-2)]">
            <Clock size={16} className="mt-0.5 shrink-0 text-[var(--muted)]" />
            <p><strong>{preview.unknownTimingCount}</strong> have no recorded call time for {WEEKDAYS[weekday]}, so they were placed by distance alone. Ask the rep to confirm timings on the visit.</p>
          </div>
        )}

        <ol className="space-y-2">
          {preview.stops.map(stop => (
            <li key={stop.doctor._id} className={`flex items-center gap-3 rounded-[10px] border p-3 ${stop.withinCallTime ? "border-[var(--line)]" : "border-[var(--warn-line)] bg-[var(--warn-bg)]"}`}>
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--brand)] text-[11px] font-bold text-[var(--on-brand)]">{stop.sequence}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{stop.doctor.name}</p>
                <p className="truncate text-xs text-[var(--muted)]">{placeOf(stop.doctor)}</p>
                {!stop.withinCallTime && <p className="text-xs font-medium text-[var(--warn-ink)]">Outside the doctor&apos;s call window</p>}
                {stop.timingUnknown && <p className="text-xs text-[var(--muted)]">Call time not recorded</p>}
                {stop.waitMinutes > 0 && <p className="text-xs text-[var(--muted)]">Waits {formatDuration(stop.waitMinutes)} for the window to open</p>}
              </div>
              <div className="shrink-0 text-right">
                <p className="text-xs font-bold text-[var(--brand)]">{toDisplayTime(stop.plannedStart)}</p>
                <p className="text-[11px] text-[var(--muted)]">{stop.sequence === 1 ? "start" : `${stop.distanceFromPreviousKm} km`}</p>
              </div>
              {directionsUrl(stop.doctor) ? (
                <a href={directionsUrl(stop.doctor)!} target="_blank" rel="noreferrer" aria-label={`Open ${stop.doctor.name} in Google Maps`}
                  className="tap grid shrink-0 place-items-center rounded-[10px] text-[var(--brand)] hover:bg-[var(--brand-soft)]"><Navigation size={15} /></a>
              ) : (
                <span title="No location recorded" className="grid size-11 shrink-0 place-items-center text-[var(--line-2)]"><Navigation size={15} /></span>
              )}
            </li>
          ))}
        </ol>

        {link && <a href={link} target="_blank" rel="noreferrer" className="inline-flex min-h-[44px] items-center gap-2 rounded-[10px] border border-[var(--line-2)] bg-[var(--surface)] px-4 text-sm font-semibold hover:bg-[var(--surface-2)]">
          <ExternalLink size={15} />Open in Google Maps
        </a>}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Plan name"><input value={name} onChange={e => setName(e.target.value)} className="input" /></Field>
          <Field label="Assign to" hint="Assigning creates the day's visits for that person">
            <select value={assignedTo} onChange={e => setAssignedTo(e.target.value)} className="select">
              <option value="">Save as draft</option>
              {team.map(person => <option key={person._id} value={person._id}>{person.name} ({person.employeeId}) · {person.role}</option>)}
            </select>
          </Field>
        </div>

        <Button onClick={save} busy={saving}><Save size={16} />{assignedTo ? "Save and assign" : "Save as draft"}</Button>
      </div>
    </Card>}
  </div>;
}

export default function NewPlan() {
  return <Suspense fallback={<Spinner label="Loading the planner…" />}><PlanBuilder /></Suspense>;
}
