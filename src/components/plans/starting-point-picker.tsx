"use client";

import { useEffect, useState } from "react";
import { Clock, Home, LocateFixed, MapPin, Navigation, Stethoscope, X } from "lucide-react";
import { Button, Field, Notice } from "@/components/ui/kit";
import { DoctorPicker, placeOf, type PickableDoctor } from "@/components/doctors/doctor-picker";
import { callTimeOn } from "@/lib/doctors/call-schedule";
import { requestFix, FIX_MESSAGE } from "@/lib/geo-fix";
import { isLatitude, isLongitude } from "@/lib/geo";

export type PlanOriginValue =
  | { kind: "doctor"; doctor: PickableDoctor }
  | { kind: "location" | "home" | "custom"; label: string; latitude: number; longitude: number };

type Tab = "doctor" | "location" | "home" | "custom";
type HomeInfo = { address?: string; latitude?: number; longitude?: number };

const TABS: { id: Tab; label: string; icon: typeof Stethoscope }[] = [
  { id: "doctor", label: "A doctor", icon: Stethoscope },
  { id: "location", label: "My location", icon: LocateFixed },
  { id: "home", label: "Home", icon: Home },
  { id: "custom", label: "Custom place", icon: MapPin }
];

/**
 * Where the day starts. A doctor is the common case; the other three give a
 * rep — or an admin planning for themself — a coordinate that is nobody's
 * doctor, which the planner treats as a starting point rather than a visit.
 */
export function StartingPointPicker({ weekday, excludeDoctorIds, value, onChange }: {
  weekday?: number;
  excludeDoctorIds?: Set<string>;
  value: PlanOriginValue | null;
  onChange: (value: PlanOriginValue | null) => void;
}) {
  const [tab, setTab] = useState<Tab>("doctor");
  const [error, setError] = useState("");

  const [home, setHome] = useState<HomeInfo | null>(null);
  const [loadingHome, setLoadingHome] = useState(true);
  const [homeAddress, setHomeAddress] = useState("");
  const [homeLat, setHomeLat] = useState("");
  const [homeLng, setHomeLng] = useState("");

  const [customLabel, setCustomLabel] = useState("");
  const [customLat, setCustomLat] = useState("");
  const [customLng, setCustomLng] = useState("");

  useEffect(() => {
    fetch("/api/auth/me").then(r => r.json())
      .then((json: { data?: { homeAddress?: string; homeLocation?: { coordinates?: number[] } } }) => {
        const coordinates = json.data?.homeLocation?.coordinates;
        setHome(coordinates?.length === 2 ? { address: json.data?.homeAddress, longitude: coordinates[0], latitude: coordinates[1] } : {});
      })
      .finally(() => setLoadingHome(false));
  }, []);

  async function useCurrentLocation() {
    setError("");
    const result = await requestFix();
    if (!result.fix) { setError(FIX_MESSAGE[result.reason]); return; }
    onChange({ kind: "location", label: "My location", latitude: result.fix.latitude, longitude: result.fix.longitude });
  }

  async function useHomeForCurrentLocation() {
    setError("");
    const result = await requestFix();
    if (!result.fix) { setError(FIX_MESSAGE[result.reason]); return; }
    setHomeLat(String(result.fix.latitude));
    setHomeLng(String(result.fix.longitude));
  }

  async function saveHome() {
    const latitude = Number(homeLat);
    const longitude = Number(homeLng);
    if (!isLatitude(latitude) || !isLongitude(longitude)) {
      setError("Enter a valid latitude (-90 to 90) and longitude (-180 to 180), or use your current location.");
      return;
    }
    setError("");
    const response = await fetch("/api/auth/home", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: homeAddress.trim() || undefined, latitude, longitude })
    });
    const json = await response.json() as { error?: string };
    if (!response.ok) { setError(json.error ?? "Could not save your home location"); return; }
    setHome({ address: homeAddress.trim() || undefined, latitude, longitude });
    onChange({ kind: "home", label: "Home", latitude, longitude });
  }

  function useCustomPlace() {
    const latitude = Number(customLat);
    const longitude = Number(customLng);
    if (!isLatitude(latitude) || !isLongitude(longitude)) {
      setError("Enter a valid latitude (-90 to 90) and longitude (-180 to 180).");
      return;
    }
    if (!customLabel.trim()) { setError("Give this place a name."); return; }
    setError("");
    onChange({ kind: "custom", label: customLabel.trim(), latitude, longitude });
  }

  if (value) {
    const isDoctor = value.kind === "doctor";
    const Icon = isDoctor ? Stethoscope : TABS.find(t => t.id === value.kind)?.icon ?? MapPin;
    const label = isDoctor ? value.doctor.name : value.label;
    const sublabel = isDoctor ? placeOf(value.doctor) : `${value.latitude.toFixed(5)}, ${value.longitude.toFixed(5)}`;
    return <div className="flex items-center gap-3 rounded-[10px] border border-[var(--brand)] bg-[var(--brand-soft)]/40 p-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--brand)] text-[var(--on-brand)]"><Icon size={15} /></span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{label}</p>
        <p className="truncate text-xs text-[var(--muted)]">{sublabel}</p>
        {isDoctor && weekday !== undefined && (
          <p className={`mt-0.5 flex items-center gap-1 text-xs font-medium ${callTimeOn(value.doctor, weekday) ? "text-[var(--brand)]" : "text-[var(--warn-ink)]"}`}>
            <Clock size={11} />{callTimeOn(value.doctor, weekday) ?? `No call time on that day`}
          </p>
        )}
      </div>
      <button onClick={() => onChange(null)} aria-label="Change the starting point"
        className="tap grid shrink-0 place-items-center rounded-[10px] text-[var(--muted)] hover:bg-[var(--surface)]"><X size={16} /></button>
    </div>;
  }

  return <div className="space-y-3">
    <div className="flex flex-wrap gap-1.5 rounded-[10px] border border-[var(--line)] bg-[var(--surface-2)] p-1">
      {TABS.map(t => (
        <button key={t.id} onClick={() => { setTab(t.id); setError(""); }}
          className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-[8px] px-2 py-2 text-xs font-semibold ${tab === t.id ? "bg-[var(--surface)] text-[var(--brand)] shadow-sm" : "text-[var(--ink-2)]"}`}>
          <t.icon size={13} />{t.label}
        </button>
      ))}
    </div>

    {tab === "doctor" && (
      <DoctorPicker weekday={weekday} excludeIds={excludeDoctorIds}
        onSelect={doctor => onChange({ kind: "doctor", doctor })}
        placeholder="Search the doctor you start the day from" />
    )}

    {tab === "location" && (
      <Button onClick={useCurrentLocation} className="w-full"><LocateFixed size={15} />Use my current location</Button>
    )}

    {tab === "home" && (loadingHome ? <p className="text-sm text-[var(--muted)]">Loading…</p> : home?.latitude !== undefined ? (
      <div className="space-y-2">
        <div className="rounded-[10px] border border-[var(--line)] p-3 text-sm">
          <p className="font-medium">{home.address || "Home"}</p>
          <p className="text-xs text-[var(--muted)]">{home.latitude!.toFixed(5)}, {home.longitude!.toFixed(5)}</p>
        </div>
        <Button onClick={() => onChange({ kind: "home", label: "Home", latitude: home.latitude!, longitude: home.longitude! })} className="w-full">
          <Home size={15} />Start from home
        </Button>
        <button onClick={() => { setHomeLat(String(home.latitude)); setHomeLng(String(home.longitude)); setHomeAddress(home.address ?? ""); setHome({}); }}
          className="text-xs font-semibold text-[var(--brand)] hover:underline">Update home location</button>
      </div>
    ) : (
      <div className="space-y-3 rounded-[10px] border border-[var(--line)] p-3">
        <p className="text-xs text-[var(--muted)]">You haven&apos;t saved a home location yet — set it once and it&apos;s remembered for next time.</p>
        <Button tone="secondary" onClick={useHomeForCurrentLocation} className="w-full"><LocateFixed size={15} />Fill in with my current location</Button>
        <Field label="Address (optional)"><input value={homeAddress} onChange={e => setHomeAddress(e.target.value)} placeholder="e.g. HSR Layout, Bengaluru" className="input" /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Latitude"><input value={homeLat} onChange={e => setHomeLat(e.target.value)} inputMode="decimal" placeholder="12.9716" className="input" /></Field>
          <Field label="Longitude"><input value={homeLng} onChange={e => setHomeLng(e.target.value)} inputMode="decimal" placeholder="77.5946" className="input" /></Field>
        </div>
        <Button onClick={saveHome} className="w-full">Save as my home &amp; use it</Button>
      </div>
    ))}

    {tab === "custom" && (
      <div className="space-y-3 rounded-[10px] border border-[var(--line)] p-3">
        <Field label="Place name"><input value={customLabel} onChange={e => setCustomLabel(e.target.value)} placeholder="e.g. Distributor warehouse" className="input" /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Latitude"><input value={customLat} onChange={e => setCustomLat(e.target.value)} inputMode="decimal" placeholder="12.9716" className="input" /></Field>
          <Field label="Longitude"><input value={customLng} onChange={e => setCustomLng(e.target.value)} inputMode="decimal" placeholder="77.5946" className="input" /></Field>
        </div>
        <Button onClick={useCustomPlace} className="w-full"><Navigation size={15} />Start from here</Button>
      </div>
    )}

    {error && <Notice tone="error">{error}</Notice>}
  </div>;
}
