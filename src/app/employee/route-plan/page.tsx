import { MapPin, Phone } from "lucide-react";
import { requireAuth } from "@/lib/auth/authorize";
import { connectDb } from "@/lib/db/mongoose";
import { RoutePlan } from "@/models/CRM";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";

type PlanDoc={
  _id:unknown;name:string;date:Date;status:string;totalDistanceKm:number;
  stops:Array<{sequence:number;distanceFromPreviousKm:number;doctor?:{name?:string;clinicName?:string;area?:string;city?:string;phones?:string[]}}>;
};

export default async function EmployeeRoutePlan(){
  const session=await requireAuth();
  await connectDb();
  const plans=await RoutePlan.find({assignedTo:session.userId}).populate("stops.doctor","name clinicName area city phones").sort({date:-1}).limit(5).lean() as unknown as PlanDoc[];
  const [current,...previous]=plans;

  return <div className="space-y-6">
    <PageHeader title="Route plan" subtitle="Your assigned visit order, nearest doctor first"/>
    {!current&&<div className="surface p-8 text-center text-sm text-[#697572]">No route plan has been assigned to you yet. Ask your admin to build one from the route planner.</div>}
    {current&&<section className="surface overflow-hidden">
      <div className="flex items-center justify-between border-b border-[#e5e9e7] px-5 py-4"><div><h2 className="font-semibold">{current.name}</h2><p className="mt-0.5 text-xs text-[#697572]">{new Date(current.date).toLocaleDateString("en-IN",{weekday:"long",day:"numeric",month:"long"})} · {current.totalDistanceKm} km total</p></div><StatusBadge value={current.status}/></div>
      <ol className="divide-y divide-[#edf0ef]">{current.stops.map(stop=><li key={stop.sequence} className="flex items-start gap-3 px-5 py-4"><span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#173f3a] text-xs font-bold text-white">{stop.sequence}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{stop.doctor?.name??"Doctor removed"}</p><p className="mt-0.5 flex items-center gap-1 truncate text-xs text-[#697572]"><MapPin size={13}/>{[stop.doctor?.clinicName,stop.doctor?.area,stop.doctor?.city].filter(Boolean).join(", ")||"—"}</p>{stop.doctor?.phones?.[0]&&<p className="mt-0.5 flex items-center gap-1 text-xs text-[#697572]"><Phone size={13}/>{stop.doctor.phones[0]}</p>}</div><span className="shrink-0 text-xs font-medium text-[#697572]">{stop.sequence===1?"Start":`+${stop.distanceFromPreviousKm} km`}</span></li>)}</ol>
    </section>}

    {previous.length>0&&<section>
      <h2 className="mb-3 font-semibold">Earlier plans</h2>
      <div className="surface divide-y divide-[#edf0ef]">{previous.map(plan=><div key={String(plan._id)} className="flex items-center justify-between px-5 py-4"><div className="min-w-0"><p className="truncate text-sm font-semibold">{plan.name}</p><p className="mt-0.5 text-xs text-[#697572]">{new Date(plan.date).toLocaleDateString("en-IN")} · {plan.stops.length} stops · {plan.totalDistanceKm} km</p></div><StatusBadge value={plan.status}/></div>)}</div>
    </section>}
  </div>;
}
