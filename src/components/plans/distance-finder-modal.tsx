"use client";

import { useMemo, useState } from "react";
import {
  ArrowDown, ArrowUp, ExternalLink, ListOrdered, LocateFixed, MapPin,
  Navigation, Ruler, Table2, Trash2, X
} from "lucide-react";
import { Button, Card, Field, Notice } from "@/components/ui/kit";
import { Modal } from "@/components/ui/modal";
import { DoctorPicker, placeOf, type PickableDoctor } from "@/components/doctors/doctor-picker";
import { haversineKm } from "@/lib/routing";
import { routeUrl, directionsUrl } from "@/lib/maps";
import { requestFix, FIX_MESSAGE } from "@/lib/geo-fix";
import { isLatitude, isLongitude } from "@/lib/geo";

type Point = { id: string; label: string; sublabel?: string; latitude: number; longitude: number };
type SortMode = "manual" | "fromStart" | "optimized";

/** Straight-line distances only need what `haversineKm` already uses. */
const asCoordinates = (point: Point) => ({ latitude: point.latitude, longitude: point.longitude });
/** `routeUrl`/`directionsUrl` speak GeoJSON — [longitude, latitude]. */
const asLocated = (point: Point) => ({ location: { coordinates: [point.longitude, point.latitude] } });

const newId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `pt-${Date.now()}-${Math.random()}`);

/** Straight-line kilometres for the average city speed a rep actually drives at. */
const SPEED_KMH = 25;

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Sorts everything after the start point by distance from it, nearest first. */
function sortFromStart(points: Point[]): Point[] {
  if (points.length < 2) return points;
  const [start, ...rest] = points;
  const ranked = rest
    .map(point => ({ point, distance: haversineKm(asCoordinates(start), asCoordinates(point)) }))
    .sort((a, b) => a.distance - b.distance);
  return [start, ...ranked.map(r => r.point)];
}

/** Greedy nearest-neighbour: from the start, always hop to whichever remaining stop is closest. */
function optimizeRoute(points: Point[]): Point[] {
  if (points.length < 2) return points;
  const [start, ...rest] = points;
  const remaining = [...rest];
  const ordered = [start];
  let current = start;
  while (remaining.length) {
    let bestIndex = 0;
    let bestDistance = Infinity;
    remaining.forEach((point, index) => {
      const distance = haversineKm(asCoordinates(current), asCoordinates(point));
      if (distance < bestDistance) { bestDistance = distance; bestIndex = index; }
    });
    const [next] = remaining.splice(bestIndex, 1);
    ordered.push(next);
    current = next;
  }
  return ordered;
}

function PointRow({ point, index, isStart, legKm, onMoveUp, onMoveDown, onRemove }: {
  point: Point; index: number; isStart: boolean; legKm: number | null;
  onMoveUp?: () => void; onMoveDown?: () => void; onRemove: () => void;
}) {
  const destination = directionsUrl(asLocated(point));
  return <li className="flex items-center gap-3 px-3 py-2.5">
    <span className={`grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-bold ${isStart ? "bg-[var(--brand)] text-[var(--on-brand)]" : "bg-[var(--surface-2)] text-[var(--ink-2)]"}`}>
      {index + 1}
    </span>
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-medium">{point.label}</p>
      <p className="truncate text-xs text-[var(--muted)]">
        {isStart ? "Start" : legKm !== null ? `${legKm.toFixed(2)} km from previous stop` : ""}
        {point.sublabel ? ` · ${point.sublabel}` : ""}
      </p>
    </div>
    <div className="flex shrink-0 items-center gap-0.5">
      <button onClick={onMoveUp} disabled={!onMoveUp} aria-label={`Move ${point.label} up`}
        className="tap grid size-8 place-items-center rounded-[8px] text-[var(--ink-2)] hover:bg-[var(--surface-2)] disabled:opacity-30">
        <ArrowUp size={14} />
      </button>
      <button onClick={onMoveDown} disabled={!onMoveDown} aria-label={`Move ${point.label} down`}
        className="tap grid size-8 place-items-center rounded-[8px] text-[var(--ink-2)] hover:bg-[var(--surface-2)] disabled:opacity-30">
        <ArrowDown size={14} />
      </button>
      {destination && <a href={destination} target="_blank" rel="noreferrer" aria-label={`Open ${point.label} in Google Maps`}
        className="tap grid size-8 place-items-center rounded-[8px] text-[var(--brand)] hover:bg-[var(--brand-soft)]">
        <Navigation size={14} />
      </a>}
      <button onClick={onRemove} aria-label={`Remove ${point.label}`}
        className="tap grid size-8 place-items-center rounded-[8px] text-[var(--danger-ink)] hover:bg-[var(--danger-bg)]">
        <Trash2 size={14} />
      </button>
    </div>
  </li>;
}

function DistanceFinder({ onClose }: { onClose: () => void }) {
  const [points, setPoints] = useState<Point[]>([]);
  const [sortMode, setSortMode] = useState<SortMode>("manual");
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customLabel, setCustomLabel] = useState("");
  const [customLat, setCustomLat] = useState("");
  const [customLng, setCustomLng] = useState("");
  const [showMatrix, setShowMatrix] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState("");

  const excludeIds = useMemo(() => new Set(points.map(p => p.id)), [points]);

  function addPoint(point: Point) {
    setError("");
    setPoints(current => sortMode === "manual" ? [...current, point] : applySort(sortMode, [...current, point]));
  }

  function applySort(mode: SortMode, list: Point[]): Point[] {
    if (mode === "fromStart") return sortFromStart(list);
    if (mode === "optimized") return optimizeRoute(list);
    return list;
  }

  function changeSort(mode: SortMode) {
    setSortMode(mode);
    setPoints(current => applySort(mode, current));
  }

  function addDoctor(doctor: PickableDoctor) {
    const coordinates = doctor.location?.coordinates;
    if (coordinates?.length !== 2) return;
    addPoint({ id: doctor._id, label: doctor.name, sublabel: placeOf(doctor), latitude: coordinates[1], longitude: coordinates[0] });
  }

  function addCustomLocation() {
    const latitude = Number(customLat);
    const longitude = Number(customLng);
    if (!isLatitude(latitude) || !isLongitude(longitude)) {
      setError("Enter a valid latitude (-90 to 90) and longitude (-180 to 180).");
      return;
    }
    addPoint({ id: newId(), label: customLabel.trim() || `Custom location ${points.length + 1}`, latitude, longitude });
    setCustomLabel(""); setCustomLat(""); setCustomLng(""); setShowCustomForm(false);
  }

  async function useMyLocation() {
    setLocating(true); setError("");
    try {
      const result = await requestFix();
      if (!result.fix) { setError(FIX_MESSAGE[result.reason]); return; }
      addPoint({ id: newId(), label: "My location", latitude: result.fix.latitude, longitude: result.fix.longitude });
    } finally {
      setLocating(false);
    }
  }

  function removePoint(id: string) {
    setPoints(current => current.filter(p => p.id !== id));
  }

  function reorder(from: number, to: number) {
    setSortMode("manual");
    setPoints(current => move(current, from, to));
  }

  function reverseOrder() {
    setSortMode("manual");
    setPoints(current => [current[0], ...current.slice(1).reverse()]);
  }

  const legs = useMemo(() => points.slice(1).map((point, index) => haversineKm(asCoordinates(points[index]), asCoordinates(point))), [points]);
  const totalKm = legs.reduce((sum, km) => sum + km, 0);
  const driveMinutes = Math.round((totalKm / SPEED_KMH) * 60);

  const matrix = useMemo(() => showMatrix
    ? points.map(row => points.map(col => row.id === col.id ? null : haversineKm(asCoordinates(row), asCoordinates(col))))
    : null, [points, showMatrix]);

  const mapsLink = points.length >= 2 ? routeUrl(points.map(asLocated)) : null;
  const cappedWaypoints = points.length > 11;

  return <div className="space-y-4">
    <Card className="p-4">
      <p className="mb-2.5 text-[13px] font-medium text-[var(--ink-2)]">Add a doctor</p>
      <DoctorPicker excludeIds={excludeIds} onSelect={addDoctor} placeholder="Search doctor, clinic, area or city" />

      <div className="mt-3 flex flex-wrap gap-2">
        <Button tone="secondary" onClick={useMyLocation} busy={locating}><LocateFixed size={15} />Use my current location</Button>
        <Button tone="secondary" onClick={() => setShowCustomForm(current => !current)}><MapPin size={15} />Add a place by coordinates</Button>
      </div>

      {showCustomForm && <div className="mt-3 grid gap-3 rounded-[10px] border border-[var(--line)] p-3 sm:grid-cols-4">
        <div className="sm:col-span-2"><Field label="Label (optional)"><input value={customLabel} onChange={e => setCustomLabel(e.target.value)} placeholder="e.g. Distributor warehouse" className="input" /></Field></div>
        <Field label="Latitude"><input value={customLat} onChange={e => setCustomLat(e.target.value)} inputMode="decimal" placeholder="12.9716" className="input" /></Field>
        <Field label="Longitude"><input value={customLng} onChange={e => setCustomLng(e.target.value)} inputMode="decimal" placeholder="77.5946" className="input" /></Field>
        <div className="sm:col-span-4"><Button onClick={addCustomLocation}>Add to list</Button></div>
      </div>}
    </Card>

    {error && <Notice tone="error">{error}</Notice>}

    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] font-medium text-[var(--ink-2)]">{points.length} stop{points.length === 1 ? "" : "s"} · first is the starting point</p>
        {points.length > 0 && <button onClick={() => setPoints([])} className="text-xs font-semibold text-[var(--danger-ink)] hover:underline">Clear all</button>}
      </div>

      {points.length > 1 && <div className="mt-3 flex flex-wrap items-center gap-2">
        <select value={sortMode} onChange={e => changeSort(e.target.value as SortMode)} className="select w-auto">
          <option value="manual">Manual order</option>
          <option value="fromStart">Sort: nearest to start first</option>
          <option value="optimized">Sort: optimized route (nearest-neighbour)</option>
        </select>
        <Button tone="ghost" onClick={reverseOrder}><ListOrdered size={14} />Reverse order</Button>
        <Button tone="ghost" onClick={() => setShowMatrix(current => !current)}><Table2 size={14} />{showMatrix ? "Hide" : "Show"} distance matrix</Button>
      </div>}

      <div className="mt-3">
        {points.length ? (
          <ul className="divide-y divide-[var(--line)] rounded-[10px] border border-[var(--line)]">
            {points.map((point, index) => (
              <PointRow key={point.id} point={point} index={index} isStart={index === 0}
                legKm={index === 0 ? null : legs[index - 1]}
                onMoveUp={index > 0 ? () => reorder(index, index - 1) : undefined}
                onMoveDown={index < points.length - 1 ? () => reorder(index, index + 1) : undefined}
                onRemove={() => removePoint(point.id)} />
            ))}
          </ul>
        ) : (
          <p className="rounded-[10px] border border-dashed border-[var(--line-2)] px-4 py-6 text-center text-sm text-[var(--muted)]">
            Add a starting doctor or place, then keep adding stops
          </p>
        )}
      </div>

      {points.length > 1 && <div className="mt-4 grid grid-cols-2 gap-4 rounded-[10px] border border-[var(--line)] bg-[var(--surface-2)] p-4 sm:grid-cols-3">
        <div><p className="text-xs text-[var(--muted)]">Total distance</p><p className="mt-0.5 text-lg font-semibold tabular-nums">{totalKm.toFixed(2)} km</p></div>
        <div><p className="text-xs text-[var(--muted)]">Approx. drive time</p><p className="mt-0.5 text-lg font-semibold tabular-nums">{driveMinutes < 60 ? `${driveMinutes} min` : `${Math.floor(driveMinutes / 60)}h ${driveMinutes % 60}m`}</p></div>
        <div><p className="text-xs text-[var(--muted)]">Longest leg</p><p className="mt-0.5 text-lg font-semibold tabular-nums">{legs.length ? `${Math.max(...legs).toFixed(2)} km` : "–"}</p></div>
      </div>}

      {points.length > 1 && <p className="mt-2 text-xs text-[var(--muted)]">Distances are straight-line (as the crow flies); actual driving distance will be longer.</p>}
    </Card>

    {matrix && points.length > 1 && <Card className="p-4">
      <p className="mb-2.5 text-[13px] font-medium text-[var(--ink-2)]">Distance between every pair (km)</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse text-xs">
          <thead>
            <tr>
              <th className="border border-[var(--line)] bg-[var(--surface-2)] p-1.5 text-left"></th>
              {points.map((p, i) => <th key={p.id} className="border border-[var(--line)] bg-[var(--surface-2)] p-1.5 text-center font-semibold">{i + 1}</th>)}
            </tr>
          </thead>
          <tbody>
            {points.map((row, i) => <tr key={row.id}>
              <th className="border border-[var(--line)] bg-[var(--surface-2)] p-1.5 text-left font-semibold">{i + 1}. {row.label}</th>
              {matrix[i].map((value, j) => <td key={j} className="border border-[var(--line)] p-1.5 text-center tabular-nums">{value === null ? "–" : value.toFixed(2)}</td>)}
            </tr>)}
          </tbody>
        </table>
      </div>
    </Card>}

    {cappedWaypoints && <Notice tone="warning">Google Maps only shows the first 9 stops between the start and end point in one link; the rest still count in the totals above.</Notice>}

    <div className="flex flex-wrap items-center justify-between gap-3">
      <Button tone="ghost" onClick={onClose}><X size={16} />Close</Button>
      {mapsLink && <a href={mapsLink} target="_blank" rel="noreferrer"
        className="inline-flex min-h-[44px] items-center gap-2 rounded-[10px] bg-[var(--brand)] px-4 text-sm font-semibold text-[var(--on-brand)] hover:bg-[var(--brand-hover)]">
        <ExternalLink size={16} />Open route in Google Maps
      </a>}
    </div>
  </div>;
}

export function DistanceFinderButton() {
  const [open, setOpen] = useState(false);
  return <>
    <Button tone="secondary" onClick={() => setOpen(true)}><Ruler size={16} />Distance finder</Button>
    {open && <Modal title="Distance finder" description="Add doctors or places, order them, and open the whole route in Google Maps." onClose={() => setOpen(false)}>
      <DistanceFinder onClose={() => setOpen(false)} />
    </Modal>}
  </>;
}
