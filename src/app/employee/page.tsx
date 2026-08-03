import Link from "next/link";
import { startOfDay,endOfDay } from "date-fns";
import { CalendarDays, Check, ChevronRight, Clock3, MapPin, Navigation, Phone, Play, RotateCcw } from "lucide-react";
import { requireAuth } from "@/lib/auth/authorize";
import { connectDb } from "@/lib/db/mongoose";
import { User } from "@/models/User";
import { Assignment,FollowUp } from "@/models/CRM";
import { StatusBadge } from "@/components/ui/status-badge";
import { haversineKm } from "@/lib/routePlanning";

type DoctorRef={_id:unknown;name:string;clinicName?:string;area?:string;city?:string;priority?:string;location?:{coordinates?:number[]}};
type AssignmentRow={_id:unknown;scheduledTime?:string;status:string;doctor?:DoctorRef};

function greeting(hour:number){return hour<12?"Good morning":hour<17?"Good afternoon":"Good evening"}

export default async function EmployeeDashboard(){
  const session=await requireAuth();
  await connectDb();
  const now=new Date();
  const [user,assignments,followUpsDue]=await Promise.all([
    User.findById(session.userId).select("name").lean() as Promise<{name:string}|null>,
    Assignment.find({employee:session.userId,date:{$gte:startOfDay(now),$lte:endOfDay(now)}}).populate("doctor","name clinicName area city priority location").sort({scheduledTime:1}).lean() as unknown as Promise<AssignmentRow[]>,
    FollowUp.countDocuments({employee:session.userId,status:"Pending",dueAt:{$lte:endOfDay(now)}})
  ]);

  const completed=assignments.filter(a=>a.status==="Completed").length;
  const total=assignments.length;
  const progress=total?Math.round((completed/total)*100):0;
  const upNext=assignments.find(a=>a.status!=="Completed"&&a.status!=="Cancelled");

  let previousLocation:{latitude:number;longitude:number}|undefined;
  const rows=assignments.map(assignment=>{
    const coordinates=assignment.doctor?.location?.coordinates;
    const location=coordinates?.length===2?{latitude:coordinates[1],longitude:coordinates[0]}:undefined;
    const distance=location&&previousLocation?`${haversineKm(previousLocation,location).toFixed(1)} km`:"—";
    if(location)previousLocation=location;
    return {assignment,distance};
  });

  return <div className="space-y-6">
    <div><p className="text-sm text-[#6c7975]">{now.toLocaleDateString("en-IN",{weekday:"long",day:"numeric",month:"long"})}</p><h1 className="mt-1 text-2xl font-semibold">{greeting(now.getHours())}, {user?.name?.split(" ")[0]??"there"}</h1></div>

    <section className="surface flex items-center justify-between p-4">
      <div><p className="text-xs font-medium text-[#6c7975]">Daily progress</p><p className="mt-1 text-lg font-semibold">{completed} of {total} visits</p></div>
      <div className="grid size-14 place-items-center rounded-full" style={{background:`conic-gradient(#2f7469 ${progress}%, #e4e9e7 0)`}}><span className="grid size-10 place-items-center rounded-full bg-white text-xs font-bold">{progress}%</span></div>
    </section>

    {upNext&&<section>
      <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Up next</h2>{upNext.scheduledTime&&<span className="flex items-center gap-1 text-xs text-[#697572]"><Clock3 size={14}/> {upNext.scheduledTime}</span>}</div>
      <div className="rounded-2xl bg-[#173f3a] p-5 text-white">
        <div className="flex items-start justify-between"><div><h3 className="font-semibold">{upNext.doctor?.name??"Doctor"}</h3><p className="mt-1 text-sm text-white/70">{[upNext.doctor?.clinicName,upNext.doctor?.area].filter(Boolean).join(", ")||"—"}</p></div>{upNext.doctor?.priority&&<StatusBadge value={upNext.doctor.priority}/>}</div>
        <p className="mt-4 flex items-center gap-2 text-sm text-white/75"><MapPin size={15}/> {[upNext.doctor?.area,upNext.doctor?.city].filter(Boolean).join(", ")||"Location not set"}</p>
        <div className="mt-5 grid grid-cols-[1fr_52px_52px] gap-2">
          <Link href={`/employee/visits/${upNext._id}`} className="tap flex items-center justify-center gap-2 rounded-xl bg-white font-semibold text-[#173f3a]"><Play size={17} fill="currentColor"/>Start visit</Link>
          <a aria-label="Call doctor" href="tel:" className="tap grid place-items-center rounded-xl bg-white/10"><Phone size={19}/></a>
          <span aria-label="Navigate" className="tap grid place-items-center rounded-xl bg-white/10"><Navigation size={19}/></span>
        </div>
      </div>
    </section>}

    <section>
      <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Today</h2><Link href="/employee/route-plan" className="text-sm font-semibold text-[#285f57]">View plan</Link></div>
      {rows.length?<div className="space-y-3">{rows.map(({assignment,distance})=><Link key={String(assignment._id)} href={`/employee/visits/${assignment._id}`} className="surface block p-4"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><h3 className="truncate text-sm font-semibold">{assignment.doctor?.name??"Doctor"}</h3><p className="mt-0.5 text-xs text-[#6c7975]">{[assignment.doctor?.clinicName,assignment.doctor?.area].filter(Boolean).join(", ")||"—"}</p></div>{assignment.doctor?.priority&&<StatusBadge value={assignment.doctor.priority}/>}</div><div className="mt-3 flex items-center justify-between border-t border-[#edf0ef] pt-3"><div className="flex gap-4 text-xs text-[#6b7874]"><span className="flex items-center gap-1"><CalendarDays size={14}/>{assignment.scheduledTime??"No time set"}</span><span>{distance}</span></div>{assignment.status==="Completed"?<Check size={18} className="text-emerald-600"/>:<ChevronRight size={18} className="text-[#84908d]"/>}</div></Link>)}</div>:<p className="surface p-6 text-center text-sm text-[#697572]">No visits scheduled for today.</p>}
    </section>

    <Link href="/employee/follow-ups" className="tap flex w-full items-center justify-center gap-2 rounded-xl border border-[#d9e1de] bg-white text-sm font-semibold"><RotateCcw size={17}/>{followUpsDue} follow-up{followUpsDue===1?"":"s"} due</Link>
  </div>;
}
