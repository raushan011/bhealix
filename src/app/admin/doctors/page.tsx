"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Clock, Download, Mail, MapPin, Phone, Plus, Search, Stethoscope, Trash2 } from "lucide-react";
import { Badge, Button, Card, EmptyState, LinkButton, Notice, PageTitle, Spinner, statusTone } from "@/components/ui/kit";
import { Modal } from "@/components/ui/modal";
import { CallScheduleEditor, type EditableWindow } from "@/components/doctors/call-schedule-editor";
import { summariseCallSchedule } from "@/lib/doctors/call-schedule";
import type { DoctorLocation } from "@/lib/doctors/fields";

type DoctorRow = {
  _id: string; code: string; name: string; clinicName?: string; specialties?: string[];
  phones?: string[]; email?: string; fullAddress?: string; area?: string; city?: string;
  location?: { coordinates?: number[] }; callSchedule?: EditableWindow[];
  priority: string; stage: string; googleMapsUrl?: string;
};

/** Everything the list is narrowed by, kept together so it can be passed as one. */
type Filters = { q: string; location: string; missingCallTime: boolean };

function DirectoryContent() {
  const params = useSearchParams();
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Filters>({
    q: "",
    location: params.get("location") ?? "",
    missingCallTime: params.get("missingCallTime") === "1"
  });
  const [locations, setLocations] = useState<DoctorLocation[]>([]);
  const [doctors, setDoctors] = useState<DoctorRow[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [editing, setEditing] = useState<DoctorRow | null>(null);

  const load = useCallback(async (nextPage: number, next: Filters) => {
    setLoading(true);
    try {
      const search = new URLSearchParams({ q: next.q, page: String(nextPage), limit: "24" });
      if (next.location) search.set("location", next.location);
      if (next.missingCallTime) search.set("missingCallTime", "1");
      const response = await fetch(`/api/doctors?${search}`);
      const json = await response.json() as { data?: { items: DoctorRow[]; total: number; pages: number } };
      setDoctors(json.data?.items ?? []);
      setTotal(json.data?.total ?? 0);
      setPages(json.data?.pages ?? 1);
      setPage(nextPage);
    } finally { setLoading(false); }
  }, []);

  /** Every filter change restarts at page one: page 7 of the old result set means nothing here. */
  const apply = useCallback((patch: Partial<Filters>) => {
    setFilters(current => {
      const next = { ...current, ...patch };
      load(1, next);
      return next;
    });
  }, [load]);

  useEffect(() => {
    load(1, {
      q: "",
      location: params.get("location") ?? "",
      missingCallTime: params.get("missingCallTime") === "1"
    });
  }, [load, params]);

  useEffect(() => {
    fetch("/api/doctors/locations")
      .then(response => response.json())
      .then((json: { data?: { items: DoctorLocation[] } }) => setLocations(json.data?.items ?? []))
      // The filter is an aid, not the point of the page; a failure here just leaves it empty.
      .catch(() => setLocations([]));
  }, []);

  // How much of the gap sits at the chosen place, so the checkbox says whether
  // it is worth ticking before it is ticked.
  const selectedPlace = filters.location ? locations.find(place => place.name === filters.location) : undefined;
  const missingHere = selectedPlace?.missingCallTime;
  const locationTotal = selectedPlace?.total;

  async function archive(doctor: DoctorRow) {
    if (!window.confirm(`Remove ${doctor.name} from the directory? Past visit history is kept.`)) return;
    const response = await fetch(`/api/doctors/${doctor._id}`, { method: "DELETE" });
    if (response.ok) {
      setDoctors(current => current.filter(row => row._id !== doctor._id));
      setTotal(current => current - 1);
      setNotice({ tone: "success", text: `${doctor.name} removed from the directory.` });
    } else {
      setNotice({ tone: "error", text: "Could not remove that doctor." });
    }
  }

  return <div className="space-y-5">
    <PageTitle title="Doctor directory" subtitle={`${total} active doctor${total === 1 ? "" : "s"}`} actions={
      <>
        {/* Plain anchor with download: next/link would client-navigate instead of saving the file. */}
        <a href="/api/doctors/export" download className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-[10px] border border-[var(--line-2)] bg-white px-4 text-sm font-semibold hover:bg-[var(--surface-2)]">
          <Download size={16} />Export
        </a>
        <LinkButton href="/admin/doctors/new"><Plus size={16} />Add doctor</LinkButton>
      </>
    } />

    <Card className="p-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-3.5 text-[var(--muted)]" />
          <input value={query} onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") apply({ q: query }); }}
            placeholder="Name, clinic, area, city, phone or email" className="input pl-9" />
        </div>
        <div className="flex gap-2">
          <label className="relative flex-1 sm:w-56 sm:flex-none">
            <span className="sr-only">Filter by location</span>
            <MapPin size={15} className="pointer-events-none absolute left-3 top-3.5 text-[var(--muted)]" />
            <select value={filters.location} onChange={e => apply({ location: e.target.value })}
              className="select pl-9">
              <option value="">All locations</option>
              {locations.map(place => (
                <option key={place.name} value={place.name}>{place.name} ({place.total})</option>
              ))}
            </select>
          </label>
          <Button onClick={() => apply({ q: query })}>Search</Button>
        </div>
      </div>

      <label className="mt-3 flex cursor-pointer items-start gap-2 text-[13px] font-medium">
        <input type="checkbox" checked={filters.missingCallTime}
          onChange={e => apply({ missingCallTime: e.target.checked })}
          className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]" />
        <span>
          Only doctors with no call time recorded
          {filters.location && <> at <span className="font-semibold text-[var(--brand)]">{filters.location}</span></>}
          {missingHere !== undefined && (
            <span className="ml-1 font-normal text-[var(--muted)]">
              — {missingHere} of {locationTotal} {missingHere === 1 ? "is" : "are"} missing one
            </span>
          )}
        </span>
      </label>

      {(filters.location || filters.missingCallTime || filters.q) && (
        <button onClick={() => { setQuery(""); apply({ q: "", location: "", missingCallTime: false }); }}
          className="mt-2.5 text-[13px] font-semibold text-[var(--brand)] hover:underline">
          Clear filters
        </button>
      )}
    </Card>

    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

    {loading && <Spinner label="Loading doctors…" />}

    {!loading && !doctors.length && (
      <EmptyState icon={Stethoscope} title="No doctors found"
        description="Try a different search, or use Find doctors to discover new ones from Google."
        action={<LinkButton href="/admin/discover">Find doctors</LinkButton>} />
    )}

    {!loading && doctors.length > 0 && <>
      <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
        {doctors.map(doctor => {
          const hasCallTime = Boolean(doctor.callSchedule?.length);
          const hasCoordinates = Boolean(doctor.location?.coordinates?.length);
          // Google often fills the full address but leaves area/city blank, so
          // prefer whichever is actually present instead of claiming no location.
          const address = doctor.fullAddress
            || [doctor.area, doctor.city].filter(Boolean).join(", ")
            || "Address not recorded";
          // Imported records often set clinicName to the doctor name; showing it
          // again under the title just repeats the heading.
          const clinic = doctor.clinicName && doctor.clinicName !== doctor.name ? doctor.clinicName : null;
          const subtitle = [clinic, doctor.specialties?.join(", ")].filter(Boolean).join(" · ");

          return <Card key={doctor._id} className="flex flex-col p-3.5">
            <div className="flex items-start justify-between gap-2">
              <Link href={`/admin/doctors/${doctor._id}`} className="min-w-0 text-[15px] font-semibold leading-snug hover:text-[var(--brand)]">
                <span className="line-clamp-2">{doctor.name}</span>
              </Link>
              <Badge tone={statusTone(doctor.priority)}>{doctor.priority}</Badge>
            </div>
            {subtitle && <p className="mt-0.5 truncate text-xs text-[var(--muted)]">{subtitle}</p>}

            <p className="mt-2.5 flex items-start gap-1.5 text-xs leading-relaxed text-[var(--ink-2)]">
              <MapPin size={13} className="mt-[3px] shrink-0 text-[var(--muted)]" />
              <span className="line-clamp-2">{address}</span>
            </p>

            <div className={`mt-2.5 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
              hasCallTime ? "bg-[var(--brand-soft)] text-[var(--brand)]" : "bg-amber-100 text-amber-900"
            }`}>
              <Clock size={13} className="shrink-0" />
              <span className="truncate">{summariseCallSchedule(doctor.callSchedule)}</span>
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--ink-2)]">
              <span className="flex items-center gap-1.5"><Phone size={12} className="shrink-0 text-[var(--muted)]" />{doctor.phones?.[0] ?? "No phone"}</span>
              {doctor.email && <span className="flex min-w-0 items-center gap-1.5"><Mail size={12} className="shrink-0 text-[var(--muted)]" /><span className="truncate">{doctor.email}</span></span>}
              {!hasCoordinates && <span className="text-amber-800">No map pin</span>}
            </div>

            <div className="mt-3 flex items-center gap-1.5 border-t border-[var(--line)] pt-3">
              <button onClick={() => setEditing(doctor)}
                className="flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-[var(--line-2)] bg-white px-2 text-xs font-semibold hover:bg-[var(--surface-2)]">
                <Clock size={13} />{hasCallTime ? "Call time" : "Add time"}
              </button>
              <Link href={`/admin/doctors/${doctor._id}`}
                className="flex min-h-9 flex-1 items-center justify-center rounded-lg border border-[var(--line-2)] bg-white px-2 text-xs font-semibold hover:bg-[var(--surface-2)]">
                Details
              </Link>
              <button onClick={() => archive(doctor)} aria-label={`Remove ${doctor.name}`}
                className="grid size-9 shrink-0 place-items-center rounded-lg text-rose-600 hover:bg-rose-50"><Trash2 size={14} /></button>
            </div>
          </Card>;
        })}
      </div>

      {pages > 1 && (
        <nav className="flex items-center justify-between rounded-[10px] border border-[var(--line)] bg-white px-4 py-2.5">
          <p className="text-sm text-[var(--muted)]">Page {page} of {pages}</p>
          <div className="flex gap-2">
            <Button tone="secondary" disabled={page <= 1} onClick={() => load(page - 1, filters)}>Previous</Button>
            <Button tone="secondary" disabled={page >= pages} onClick={() => load(page + 1, filters)}>Next</Button>
          </div>
        </nav>
      )}
    </>}

    {editing && (
      <Modal title="MR call time" description={editing.name} onClose={() => setEditing(null)}>
        <CallScheduleEditor
          doctorId={editing._id}
          doctorName={editing.name}
          initial={editing.callSchedule ?? []}
          onCancel={() => setEditing(null)}
          onSaved={windows => {
            setDoctors(current => current.map(row => row._id === editing._id ? { ...row, callSchedule: windows } : row));
            setEditing(null);
            setNotice({ tone: "success", text: `Call time saved for ${editing.name}.` });
          }}
        />
      </Modal>
    )}
  </div>;
}

export default function DoctorDirectory() {
  return <Suspense fallback={<Spinner />}><DirectoryContent /></Suspense>;
}
