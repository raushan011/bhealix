import { notFound } from "next/navigation";
import { connectDb } from "@/lib/db/mongoose";
import { RoutePlan } from "@/models/CRM";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";

type PlanDoc={
  name:string;date:Date;status:string;totalDistanceKm:number;
  referenceDoctor?:{name?:string};
  assignedTo?:{name?:string;employeeId?:string};
  stops:Array<{sequence:number;distanceFromPreviousKm:number;doctor?:{_id:unknown;name?:string;clinicName?:string;area?:string;city?:string;phones?:string[]}}>;
};

export default async function RoutePlanDetail({params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  if(!id.match(/^[a-f\d]{24}$/i))notFound();
  await connectDb();
  const plan=await RoutePlan.findById(id).populate("referenceDoctor","name").populate("assignedTo","name employeeId").populate("stops.doctor","name clinicName area city phones").lean() as PlanDoc|null;
  if(!plan)notFound();
  return <div className="space-y-6">
    <PageHeader title={plan.name} subtitle={`${new Date(plan.date).toLocaleDateString("en-IN",{weekday:"long",day:"numeric",month:"long"})} · ${plan.totalDistanceKm} km total`} actions={<StatusBadge value={plan.status}/>}/>
    <section className="surface grid gap-5 p-5 sm:grid-cols-3">
      <div><p className="text-xs text-[#697572]">Starting doctor</p><p className="mt-1 text-sm font-semibold">{plan.referenceDoctor?.name??"—"}</p></div>
      <div><p className="text-xs text-[#697572]">Assigned to</p><p className="mt-1 text-sm font-semibold">{plan.assignedTo?`${plan.assignedTo.name} (${plan.assignedTo.employeeId})`:"Not assigned"}</p></div>
      <div><p className="text-xs text-[#697572]">Stops</p><p className="mt-1 text-sm font-semibold">{plan.stops.length}</p></div>
    </section>
    <section className="surface overflow-hidden">
      <div className="border-b border-[#e5e9e7] px-5 py-4"><h2 className="font-semibold">Visit order</h2></div>
      <ol className="divide-y divide-[#edf0ef]">{plan.stops.map(stop=><li key={String(stop.doctor?._id??stop.sequence)} className="flex items-center gap-3 px-5 py-4"><span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#173f3a] text-xs font-bold text-white">{stop.sequence}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{stop.doctor?.name??"Doctor removed"}</p><p className="truncate text-xs text-[#697572]">{[stop.doctor?.clinicName,stop.doctor?.area,stop.doctor?.city].filter(Boolean).join(", ")||"—"}{stop.doctor?.phones?.[0]&&` · ${stop.doctor.phones[0]}`}</p></div><span className="shrink-0 text-xs font-medium text-[#697572]">{stop.sequence===1?"Start":`+${stop.distanceFromPreviousKm} km`}</span></li>)}</ol>
    </section>
  </div>;
}
