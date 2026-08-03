import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MapPin, Navigation, Phone } from "lucide-react";
import { requireFieldPanel } from "@/lib/auth/guard";
import { connectDb } from "@/lib/db/mongoose";
import { Doctor } from "@/models/Doctor";
import { Visit } from "@/models/Visit";
import { Badge, Card, PageTitle, statusTone } from "@/components/ui/kit";
import { DoctorCallTimeCard } from "@/components/doctors/doctor-call-time-card";
import { OBJECT_ID } from "@/lib/api";
import { formatDate } from "@/lib/time";
import type { EditableWindow } from "@/components/doctors/call-schedule-editor";

export const dynamic = "force-dynamic";

type DoctorDoc = {
  _id: unknown; name: string; clinicName?: string; specialties?: string[]; area?: string; city?: string;
  fullAddress?: string; phones?: string[]; location?: { coordinates?: number[] }; callSchedule?: EditableWindow[];
  priority: string; stage: string;
};
type VisitDoc = {
  _id: unknown; plannedDate: Date; status: string; outcome?: string; interest?: string; notes?: string;
  samples?: Array<{ product: string; quantity: number }>;
};

export default async function FieldDoctorDetail({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireFieldPanel();
  const { id } = await params;
  if (!OBJECT_ID.test(id)) notFound();

  await connectDb();
  const [doctor, visits] = await Promise.all([
    Doctor.findById(id).select("name clinicName specialties area city fullAddress phones location callSchedule priority stage").lean() as Promise<DoctorDoc | null>,
    Visit.find({ doctor: id, employee: session.userId }).sort({ plannedDate: -1 }).limit(8).lean() as unknown as Promise<VisitDoc[]>
  ]);
  if (!doctor) notFound();

  const coordinates = doctor.location?.coordinates;

  return <div className="space-y-4">
    <Link href="/employee/doctors" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--brand)]">
      <ArrowLeft size={15} />Back to doctors
    </Link>

    <PageTitle title={doctor.name}
      subtitle={[doctor.clinicName, doctor.specialties?.join(", ")].filter(Boolean).join(" · ") || undefined}
      actions={<Badge tone={statusTone(doctor.priority)}>{doctor.priority}</Badge>} />

    <Card className="p-4">
      <p className="flex items-start gap-2 text-sm text-[var(--ink-2)]">
        <MapPin size={15} className="mt-0.5 shrink-0 text-[var(--muted)]" />
        {doctor.fullAddress || [doctor.area, doctor.city].filter(Boolean).join(", ") || "Address not recorded"}
      </p>
      <div className="mt-3 flex gap-2">
        {doctor.phones?.[0] && (
          <a href={`tel:${doctor.phones[0]}`} className="tap flex flex-1 items-center justify-center gap-2 rounded-[10px] border border-[var(--line-2)] text-sm font-semibold">
            <Phone size={15} />Call
          </a>
        )}
        {coordinates?.length === 2 && (
          <a href={`https://www.google.com/maps/dir/?api=1&destination=${coordinates[1]},${coordinates[0]}`}
            target="_blank" rel="noreferrer" className="tap flex flex-1 items-center justify-center gap-2 rounded-[10px] border border-[var(--line-2)] text-sm font-semibold">
            <Navigation size={15} />Directions
          </a>
        )}
      </div>
    </Card>

    <DoctorCallTimeCard doctorId={String(doctor._id)} doctorName={doctor.name} initial={doctor.callSchedule ?? []} />

    <Card className="p-4">
      <h2 className="text-[15px] font-semibold">Your past visits</h2>
      {visits.length ? (
        <ul className="mt-3 divide-y divide-[var(--line)]">
          {visits.map(visit => (
            <li key={String(visit._id)} className="py-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{formatDate(visit.plannedDate)}</p>
                <Badge tone={statusTone(visit.status)}>{visit.status}</Badge>
              </div>
              {visit.outcome && <p className="mt-0.5 text-xs text-[var(--muted)]">{visit.outcome}</p>}
              {Boolean(visit.samples?.length) && (
                <p className="mt-0.5 text-xs text-[var(--ink-2)]">Samples: {visit.samples!.map(s => `${s.product} ×${s.quantity}`).join(", ")}</p>
              )}
              {visit.notes && <p className="mt-0.5 text-xs italic text-[var(--muted)]">“{visit.notes}”</p>}
            </li>
          ))}
        </ul>
      ) : <p className="mt-2 text-sm text-[var(--muted)]">You have not visited this doctor yet.</p>}
    </Card>
  </div>;
}
