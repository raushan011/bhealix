import { notFound } from "next/navigation";
import { connectDb } from "@/lib/db/mongoose";
import { Doctor } from "@/models/Doctor";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
type DoctorView={name:string;clinicName?:string;priority:string;stage:string;specialties?:string[];area?:string;city?:string;phones?:string[]};
export default async function DoctorDetail({params}:{params:Promise<{id:string}>}){await connectDb();const doctor=await Doctor.findById((await params).id).select("-confidentialAdminNotes").lean() as DoctorView|null;if(!doctor)notFound();return <div className="space-y-5"><PageHeader title={doctor.name} subtitle={doctor.clinicName}/><section className="surface p-5"><div className="flex gap-2"><StatusBadge value={doctor.priority}/><StatusBadge value={doctor.stage}/></div><dl className="mt-6 grid gap-5 sm:grid-cols-2"><div><dt className="text-xs text-[#697572]">Specialty</dt><dd className="mt-1 text-sm font-medium">{doctor.specialties?.join(", ")||"—"}</dd></div><div><dt className="text-xs text-[#697572]">Location</dt><dd className="mt-1 text-sm font-medium">{[doctor.area,doctor.city].filter(Boolean).join(", ")||"—"}</dd></div><div><dt className="text-xs text-[#697572]">Phone</dt><dd className="mt-1 text-sm font-medium">{doctor.phones?.[0]||"—"}</dd></div></dl></section></div>}
