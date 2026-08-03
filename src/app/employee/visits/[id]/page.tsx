import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireFieldPanel } from "@/lib/auth/guard";
import { connectDb } from "@/lib/db/mongoose";
import { Visit } from "@/models/Visit";
import { Product } from "@/models/Catalog";
import { VisitForm } from "@/components/visits/visit-form";
import { OBJECT_ID } from "@/lib/api";
import type { EditableWindow } from "@/components/doctors/call-schedule-editor";

export const dynamic = "force-dynamic";

type VisitDoc = {
  _id: unknown; employee: unknown; status: string; plannedStart?: string; plannedDate: Date;
  outcome?: string; interest?: string; notes?: string; orderValue?: number;
  productsDiscussed?: string[]; samples?: Array<{ product: string; quantity: number }>;
  doctor?: {
    _id: unknown; name?: string; clinicName?: string; area?: string; city?: string; fullAddress?: string;
    phones?: string[]; location?: { coordinates?: number[] }; callSchedule?: EditableWindow[];
  };
};

export default async function VisitPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireFieldPanel();
  const { id } = await params;
  if (!OBJECT_ID.test(id)) notFound();

  await connectDb();
  const [visit, products] = await Promise.all([
    Visit.findById(id).populate("doctor", "name clinicName area city fullAddress phones location callSchedule").lean() as Promise<VisitDoc | null>,
    Product.find({ active: true }).select("name").sort({ name: 1 }).lean()
  ]);

  if (!visit) notFound();
  // A rep can only ever open their own visit.
  if (String(visit.employee) !== session.userId) notFound();

  return <div className="space-y-4">
    <Link href="/employee" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--brand)]">
      <ArrowLeft size={15} />Back to today
    </Link>

    <VisitForm
      visit={{
        _id: String(visit._id),
        status: visit.status,
        plannedStart: visit.plannedStart,
        outcome: visit.outcome,
        interest: visit.interest,
        notes: visit.notes ?? "",
        orderValue: visit.orderValue,
        productsDiscussed: visit.productsDiscussed ?? [],
        samples: visit.samples ?? []
      }}
      doctor={{
        _id: String(visit.doctor?._id ?? ""),
        name: visit.doctor?.name ?? "Doctor",
        clinicName: visit.doctor?.clinicName,
        area: visit.doctor?.area,
        city: visit.doctor?.city,
        fullAddress: visit.doctor?.fullAddress,
        phone: visit.doctor?.phones?.[0],
        coordinates: visit.doctor?.location?.coordinates,
        callSchedule: visit.doctor?.callSchedule ?? []
      }}
      products={products.map(product => (product as unknown as { name: string }).name)}
    />
  </div>;
}
