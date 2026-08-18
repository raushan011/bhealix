import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireFieldPanel } from "@/lib/auth/guard";
import { connectDb } from "@/lib/db/mongoose";
import { Visit } from "@/models/Visit";
import { VisitPhoto } from "@/models/VisitPhoto";
import { Product } from "@/models/Catalog";
import { VisitForm } from "@/components/visits/visit-form";
import type { PhotoLocation } from "@/components/visits/visit-photos";
import { stockFor } from "@/lib/samples/ledger";
import { OBJECT_ID } from "@/lib/api";
import { toDateInput } from "@/lib/time";
import type { EditableWindow } from "@/components/doctors/call-schedule-editor";

export const dynamic = "force-dynamic";

type VisitDoc = {
  _id: unknown; employee: unknown; status: string; plannedStart?: string; plannedDate: Date;
  outcome?: string; interest?: string; notes?: string; orderValue?: number; followUpDate?: Date;
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
  const [visit, products, stock, photos] = await Promise.all([
    Visit.findById(id).populate("doctor", "name clinicName area city fullAddress phones location callSchedule").lean() as Promise<VisitDoc | null>,
    Product.find({ active: true }).select("name").sort({ name: 1 }).lean(),
    stockFor(session.userId),
    // Metadata only — the bytes are fetched one image at a time. Anything past
    // its thirty days is left out rather than waited on.
    VisitPhoto.find({ visit: id, expiresAt: { $gt: new Date() } })
      .select("caption location createdAt expiresAt").sort({ createdAt: 1 }).lean() as
      unknown as Promise<Array<{
        _id: unknown; caption?: string; createdAt: Date; expiresAt: Date; location?: PhotoLocation;
      }>>
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
        samples: visit.samples ?? [],
        followUpDate: visit.followUpDate ? toDateInput(visit.followUpDate) : undefined
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
      stock={Object.fromEntries(stock.map(row => [row.product, row.balance]))}
      photos={photos.map(photo => ({
        _id: String(photo._id),
        caption: photo.caption,
        // A photo saved before this field existed, or with location switched
        // off, has an empty object here rather than nothing — dropped, so the
        // screen says "no location" instead of showing a point at 0°, 0°.
        location: typeof photo.location?.latitude === "number" ? photo.location : undefined,
        createdAt: photo.createdAt.toISOString(),
        expiresAt: photo.expiresAt.toISOString()
      }))}
    />
  </div>;
}
