import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, Mail, MapPin, Phone } from "lucide-react";
import { connectDb } from "@/lib/db/mongoose";
import { Doctor } from "@/models/Doctor";
import { Visit } from "@/models/Visit";
import { requireAdminPanel } from "@/lib/auth/guard";
import { Badge, Card, PageTitle, statusTone } from "@/components/ui/kit";
import { DoctorCallTimeCard } from "@/components/doctors/doctor-call-time-card";
import { DoctorDetailsForm } from "@/components/doctors/doctor-details-form";
import { OBJECT_ID } from "@/lib/api";
import { formatDate, WEEKDAYS, toDisplayTime } from "@/lib/time";
import type { EditableWindow } from "@/components/doctors/call-schedule-editor";

export const dynamic = "force-dynamic";

type DoctorDoc = {
  _id: unknown; code: string; name: string; clinicName?: string; specialties?: string[];
  phones?: string[]; email?: string; fullAddress?: string; area?: string; city?: string;
  location?: { coordinates?: number[] }; callSchedule?: EditableWindow[]; googleMapsUrl?: string;
  priority: string; stage: string; notes?: string; lastVisitedAt?: Date;
  assignedTo?: { name?: string; employeeId?: string };
};

type VisitDoc = {
  _id: unknown; plannedDate: Date; status: string; outcome?: string; interest?: string;
  notes?: string; samples?: Array<{ product: string; quantity: number }>;
  productsDiscussed?: string[]; employee?: { name?: string };
};

export default async function DoctorDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPanel();
  const { id } = await params;
  if (!OBJECT_ID.test(id)) notFound();

  await connectDb();
  const [doctor, visits] = await Promise.all([
    Doctor.findById(id).populate("assignedTo", "name employeeId").lean() as Promise<DoctorDoc | null>,
    Visit.find({ doctor: id }).populate("employee", "name").sort({ plannedDate: -1 }).limit(12).lean() as unknown as Promise<VisitDoc[]>
  ]);
  if (!doctor) notFound();

  const coordinates = doctor.location?.coordinates;

  return <div className="space-y-5">
    <Link href="/admin/doctors" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--brand)]">
      <ArrowLeft size={15} />Back to directory
    </Link>

    <PageTitle title={doctor.name} subtitle={[doctor.clinicName, doctor.specialties?.join(", ")].filter(Boolean).join(" · ") || doctor.code}
      actions={<><Badge tone={statusTone(doctor.priority)}>{doctor.priority}</Badge><Badge>{doctor.stage}</Badge></>} />

    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <Card className="p-5">
          <h2 className="text-[15px] font-semibold">Contact</h2>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            <div><dt className="text-xs text-[var(--muted)]">Phone</dt>
              <dd className="mt-0.5 flex items-center gap-2 text-sm font-medium"><Phone size={14} className="text-[var(--muted)]" />{doctor.phones?.[0] ?? "Not available"}</dd></div>
            <div><dt className="text-xs text-[var(--muted)]">Email</dt>
              {/* The truncation belongs on the text, not on the flex row around
                  it — an address with no space in it would otherwise sit outside
                  the card rather than being cut off inside it. */}
              <dd className="mt-0.5 flex items-center gap-2 text-sm font-medium">
                <Mail size={14} className="shrink-0 text-[var(--muted)]" />
                <span className="truncate">{doctor.email ?? "Not available"}</span>
              </dd></div>
            <div className="sm:col-span-2"><dt className="text-xs text-[var(--muted)]">Address</dt>
              <dd className="mt-0.5 flex items-start gap-2 text-sm font-medium"><MapPin size={14} className="mt-0.5 shrink-0 text-[var(--muted)]" />{doctor.fullAddress || [doctor.area, doctor.city].filter(Boolean).join(", ") || "Not recorded"}</dd></div>
            <div><dt className="text-xs text-[var(--muted)]">Coordinates</dt>
              <dd className={`mt-0.5 text-sm font-medium ${coordinates?.length ? "" : "text-[var(--warn-ink)]"}`}>
                {coordinates?.length ? `${coordinates[1].toFixed(5)}, ${coordinates[0].toFixed(5)}` : "Missing — cannot be route-planned"}</dd></div>
            <div><dt className="text-xs text-[var(--muted)]">Assigned to</dt>
              <dd className="mt-0.5 text-sm font-medium">{doctor.assignedTo?.name ?? "Not assigned"}</dd></div>
          </dl>
          {doctor.googleMapsUrl && (
            <a href={doctor.googleMapsUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--brand)]">
              Open in Google Maps <ExternalLink size={13} />
            </a>
          )}
        </Card>

        <DoctorDetailsForm doctor={{
          _id: String(doctor._id),
          name: doctor.name,
          clinicName: doctor.clinicName ?? "",
          specialties: doctor.specialties ?? [],
          phone: doctor.phones?.[0] ?? "",
          email: doctor.email ?? "",
          fullAddress: doctor.fullAddress ?? "",
          area: doctor.area ?? "",
          city: doctor.city ?? "",
          latitude: coordinates?.[1],
          longitude: coordinates?.[0],
          priority: doctor.priority,
          stage: doctor.stage,
          notes: doctor.notes ?? ""
        }} />

        <Card className="p-5">
          <h2 className="text-[15px] font-semibold">Visit history</h2>
          {visits.length ? (
            <ul className="mt-3 divide-y divide-[var(--line)]">
              {visits.map(visit => (
                <li key={String(visit._id)} className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{formatDate(visit.plannedDate)}</p>
                    <div className="flex items-center gap-1.5">
                      {visit.interest && <Badge tone={statusTone(visit.interest)}>{visit.interest}</Badge>}
                      <Badge tone={statusTone(visit.status)}>{visit.status}</Badge>
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {visit.employee?.name ?? "Unassigned"}{visit.outcome ? ` · ${visit.outcome}` : ""}
                  </p>
                  {Boolean(visit.samples?.length) && (
                    <p className="mt-1 text-xs text-[var(--ink-2)]">
                      Samples: {visit.samples!.map(sample => `${sample.product} ×${sample.quantity}`).join(", ")}
                    </p>
                  )}
                  {Boolean(visit.productsDiscussed?.length) && (
                    <p className="mt-0.5 text-xs text-[var(--ink-2)]">Discussed: {visit.productsDiscussed!.join(", ")}</p>
                  )}
                  {visit.notes && <p className="mt-1 text-xs italic text-[var(--muted)]">“{visit.notes}”</p>}
                </li>
              ))}
            </ul>
          ) : <p className="mt-2 text-sm text-[var(--muted)]">No visits recorded yet.</p>}
        </Card>
      </div>

      <div className="space-y-4">
        <DoctorCallTimeCard doctorId={String(doctor._id)} doctorName={doctor.name} initial={doctor.callSchedule ?? []} />

        {Boolean(doctor.callSchedule?.length) && (
          <Card className="p-5">
            <h2 className="text-[15px] font-semibold">Weekly timing</h2>
            <ul className="mt-3 space-y-2">
              {[...doctor.callSchedule!].sort((a, b) => a.weekday - b.weekday).map(window => (
                <li key={window.weekday} className="text-sm">
                  <span className="font-semibold">{WEEKDAYS[window.weekday]}</span>
                  <span className="text-[var(--ink-2)]"> · {window.slots.map(slot => `${toDisplayTime(slot.start)}–${toDisplayTime(slot.end)}`).join(", ")}</span>
                  {window.appointmentRequired && <Badge tone="warn">Appointment</Badge>}
                  {window.remarks && <p className="mt-0.5 text-xs text-[var(--muted)]">{window.remarks}</p>}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  </div>;
}
