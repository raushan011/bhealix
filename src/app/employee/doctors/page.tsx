"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, Clock, MapPin, Phone, Search, Stethoscope } from "lucide-react";
import { EmptyState, PageTitle, Spinner } from "@/components/ui/kit";
import { summariseCallSchedule } from "@/lib/doctors/call-schedule";
import type { EditableWindow } from "@/components/doctors/call-schedule-editor";

type DoctorRow = {
  _id: string; name: string; clinicName?: string; area?: string; city?: string;
  phones?: string[]; callSchedule?: EditableWindow[];
};

export default function FieldDoctors() {
  const [query, setQuery] = useState("");
  const [doctors, setDoctors] = useState<DoctorRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (search: string) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/doctors?q=${encodeURIComponent(search)}&limit=30`);
      const json = await response.json() as { data?: { items: DoctorRow[] } };
      setDoctors(json.data?.items ?? []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(""); }, [load]);

  return <div className="space-y-4">
    <PageTitle title="Doctors" subtitle="Look up a doctor and keep their call time correct" />

    <div className="relative">
      <Search size={16} className="pointer-events-none absolute left-3 top-3.5 text-[var(--muted)]" />
      <input value={query} onChange={e => setQuery(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") load(query); }}
        placeholder="Name, clinic, area or city" className="input pl-9" />
    </div>

    {loading && <Spinner label="Loading…" />}

    {!loading && !doctors.length && (
      <EmptyState icon={Stethoscope} title="No doctors found" description="Try a different name or area." />
    )}

    {!loading && doctors.length > 0 && (
      <div className="space-y-2">
        {doctors.map(doctor => (
          <Link key={doctor._id} href={`/employee/doctors/${doctor._id}`} className="card flex items-center gap-3 p-3.5 active:bg-[var(--surface-2)]">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{doctor.name}</p>
              <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-[var(--muted)]">
                <MapPin size={11} className="shrink-0" />{[doctor.clinicName, doctor.area, doctor.city].filter(Boolean).join(" · ") || "—"}
              </p>
              <p className={`mt-0.5 flex items-center gap-1 truncate text-xs font-medium ${doctor.callSchedule?.length ? "text-[var(--brand)]" : "text-amber-700"}`}>
                <Clock size={11} className="shrink-0" />{summariseCallSchedule(doctor.callSchedule)}
              </p>
              {doctor.phones?.[0] && (
                <p className="mt-0.5 flex items-center gap-1 text-xs text-[var(--ink-2)]"><Phone size={11} />{doctor.phones[0]}</p>
              )}
            </div>
            <ChevronRight size={16} className="shrink-0 text-[var(--muted)]" />
          </Link>
        ))}
      </div>
    )}
  </div>;
}
