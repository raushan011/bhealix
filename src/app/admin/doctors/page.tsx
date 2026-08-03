"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Clock, Download, Mail, MapPin, Phone, Plus, Search, Stethoscope, Trash2 } from "lucide-react";
import { Badge, Button, Card, EmptyState, LinkButton, Notice, PageTitle, Spinner, statusTone } from "@/components/ui/kit";
import { Modal } from "@/components/ui/modal";
import { CallScheduleEditor, type EditableWindow } from "@/components/doctors/call-schedule-editor";
import { summariseCallSchedule } from "@/lib/doctors/call-schedule";

type DoctorRow = {
  _id: string; code: string; name: string; clinicName?: string; specialties?: string[];
  phones?: string[]; email?: string; fullAddress?: string; area?: string; city?: string;
  location?: { coordinates?: number[] }; callSchedule?: EditableWindow[];
  priority: string; stage: string; googleMapsUrl?: string;
};

function DirectoryContent() {
  const params = useSearchParams();
  const [query, setQuery] = useState("");
  const [onlyMissingCallTime, setOnlyMissingCallTime] = useState(params.get("missingCallTime") === "1");
  const [doctors, setDoctors] = useState<DoctorRow[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [editing, setEditing] = useState<DoctorRow | null>(null);

  const load = useCallback(async (nextPage: number, search: string, missingOnly: boolean) => {
    setLoading(true);
    try {
      const url = `/api/doctors?q=${encodeURIComponent(search)}&page=${nextPage}&limit=24${missingOnly ? "&missingCallTime=1" : ""}`;
      const response = await fetch(url);
      const json = await response.json() as { data?: { items: DoctorRow[]; total: number; pages: number } };
      setDoctors(json.data?.items ?? []);
      setTotal(json.data?.total ?? 0);
      setPages(json.data?.pages ?? 1);
      setPage(nextPage);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(1, "", params.get("missingCallTime") === "1"); }, [load, params]);

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
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-3.5 text-[var(--muted)]" />
          <input value={query} onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") load(1, query, onlyMissingCallTime); }}
            placeholder="Name, clinic, area, city, phone or email" className="input pl-9" />
        </div>
        <Button onClick={() => load(1, query, onlyMissingCallTime)}>Search</Button>
      </div>
      <label className="mt-3 flex cursor-pointer items-center gap-2 text-[13px] font-medium">
        <input type="checkbox" checked={onlyMissingCallTime}
          onChange={e => { setOnlyMissingCallTime(e.target.checked); load(1, query, e.target.checked); }}
          className="size-4 accent-[var(--brand)]" />
        Only doctors with no call time recorded
      </label>
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
          const subtitle = [doctor.clinicName, doctor.specialties?.join(", ")]
            .filter(Boolean).filter((value, index, all) => all.indexOf(value) === index).join(" · ");

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
            <Button tone="secondary" disabled={page <= 1} onClick={() => load(page - 1, query, onlyMissingCallTime)}>Previous</Button>
            <Button tone="secondary" disabled={page >= pages} onClick={() => load(page + 1, query, onlyMissingCallTime)}>Next</Button>
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
